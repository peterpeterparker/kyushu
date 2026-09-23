//! Target-independent buffering and fan-out for cloned fetch response bodies.

use rquickjs::{Ctx, Exception};
use std::cell::RefCell;
use std::collections::HashMap;
use std::rc::Rc;
use std::task::{Poll, Waker};

pub(crate) trait NativeBody {
    async fn read_chunk(&mut self) -> Result<Option<Vec<u8>>, String>;
    fn discard(self);
    #[cfg(all(feature = "p3", feature = "internal-test-execution"))]
    fn take_recovered_read_bytes_for_test(&self) -> usize {
        0
    }
    #[cfg(all(feature = "p3", feature = "internal-test-execution"))]
    fn pause_next_ready_read_for_test(&self) -> bool {
        false
    }
}

pub(crate) struct SharedBody<S> {
    native: Option<S>,
    buffer: Vec<u8>,
    buffer_head: usize,
    buffer_start: usize,
    finished: bool,
    error: Option<String>,
    waiters: Vec<Waker>,
    reader_positions: HashMap<usize, usize>,
    next_reader_id: usize,
    #[cfg(test)]
    compactions: usize,
}

impl<S: NativeBody> SharedBody<S> {
    fn new(native: S) -> Self {
        Self {
            native: Some(native),
            buffer: Vec::new(),
            buffer_head: 0,
            buffer_start: 0,
            finished: false,
            error: None,
            waiters: Vec::new(),
            reader_positions: HashMap::from([(0, 0), (1, 0)]),
            next_reader_id: 2,
            #[cfg(test)]
            compactions: 0,
        }
    }
}

pub(crate) struct SharedBodyReader<S: NativeBody> {
    shared: Rc<RefCell<SharedBody<S>>>,
    reader_id: usize,
    active: bool,
}

pub(crate) struct SharedBodyCompletion<S: NativeBody> {
    shared: Rc<RefCell<SharedBody<S>>>,
}

impl<S: NativeBody> SharedBodyReader<S> {
    pub(crate) fn pair(native: S) -> (Self, Self) {
        let shared = Rc::new(RefCell::new(SharedBody::new(native)));
        (
            Self {
                shared: shared.clone(),
                reader_id: 0,
                active: true,
            },
            Self {
                shared,
                reader_id: 1,
                active: true,
            },
        )
    }

    pub(crate) fn branch(&self) -> Self {
        let reader_id = {
            let mut state = self.shared.borrow_mut();
            let position = state.reader_positions[&self.reader_id];
            let reader_id = state.next_reader_id;
            state.next_reader_id += 1;
            state.reader_positions.insert(reader_id, position);
            reader_id
        };
        Self {
            shared: self.shared.clone(),
            reader_id,
            active: true,
        }
    }

    pub(crate) fn completion(&self) -> SharedBodyCompletion<S> {
        SharedBodyCompletion {
            shared: self.shared.clone(),
        }
    }

    pub(crate) async fn discard_and_wait(self) {
        let completion = self.completion();
        drop(self);
        completion.wait().await;
    }

    pub(crate) fn discard(self) {
        drop(self);
    }

    #[cfg(all(feature = "p3", feature = "internal-test-execution"))]
    pub(crate) fn take_recovered_read_bytes_for_test(&self) -> usize {
        self.shared
            .borrow()
            .native
            .as_ref()
            .map_or(0, NativeBody::take_recovered_read_bytes_for_test)
    }

    #[cfg(all(feature = "p3", feature = "internal-test-execution"))]
    pub(crate) fn pause_next_ready_read_for_test(&self) -> bool {
        self.shared
            .borrow()
            .native
            .as_ref()
            .is_some_and(NativeBody::pause_next_ready_read_for_test)
    }
}

impl<S: NativeBody> SharedBodyCompletion<S> {
    pub(crate) async fn wait(self) {
        std::future::poll_fn(|cx| {
            let mut state = self.shared.borrow_mut();
            if state.finished || state.reader_positions.is_empty() {
                Poll::Ready(())
            } else {
                if !state
                    .waiters
                    .iter()
                    .any(|waker| waker.will_wake(cx.waker()))
                {
                    state.waiters.push(cx.waker().clone());
                }
                Poll::Pending
            }
        })
        .await;
    }
}

impl<S: NativeBody> Drop for SharedBodyReader<S> {
    fn drop(&mut self) {
        if !self.active {
            return;
        }
        self.active = false;
        let (native, waiters) = {
            let mut state = self.shared.borrow_mut();
            assert!(
                state.reader_positions.remove(&self.reader_id).is_some(),
                "shared response reader is registered"
            );
            reclaim_consumed_prefix(&mut state);
            if state.reader_positions.is_empty() && !state.finished {
                state.finished = true;
                (state.native.take(), std::mem::take(&mut state.waiters))
            } else {
                (None, Vec::new())
            }
        };
        if let Some(native) = native {
            native.discard();
        }
        wake_all(waiters);
    }
}

struct NativeLease<S: NativeBody> {
    native: Option<S>,
    shared: Rc<RefCell<SharedBody<S>>>,
}

impl<S: NativeBody> Drop for NativeLease<S> {
    fn drop(&mut self) {
        let Some(native) = self.native.take() else {
            return;
        };
        let (native, waiters) = {
            let mut state = self.shared.borrow_mut();
            let discard = state.reader_positions.is_empty() || state.finished;
            if discard {
                state.finished = true;
                (Some(native), std::mem::take(&mut state.waiters))
            } else {
                state.native = Some(native);
                (None, std::mem::take(&mut state.waiters))
            }
        };
        if let Some(native) = native {
            native.discard();
        }
        wake_all(waiters);
    }
}

pub(crate) async fn collect<'js, S: NativeBody>(
    ctx: &Ctx<'js>,
    reader: SharedBodyReader<S>,
) -> rquickjs::Result<Vec<u8>> {
    let mut bytes = Vec::new();
    while let Some(chunk) = read_chunk(ctx, &reader).await? {
        bytes.extend_from_slice(&chunk);
    }
    Ok(bytes)
}

pub(crate) async fn read_chunk<'js, S: NativeBody>(
    ctx: &Ctx<'js>,
    reader: &SharedBodyReader<S>,
) -> rquickjs::Result<Option<Vec<u8>>> {
    let shared = &reader.shared;
    loop {
        {
            let mut state = shared.borrow_mut();
            let position = state.reader_positions[&reader.reader_id];
            let buffer_end = state.buffer_start + state.buffer.len() - state.buffer_head;
            if position < buffer_end {
                let start = state.buffer_head + position - state.buffer_start;
                let end = (start + 16 * 1024).min(state.buffer.len());
                let chunk = state.buffer[start..end].to_vec();
                let reader_position = state.buffer_start + end - state.buffer_head;
                state
                    .reader_positions
                    .insert(reader.reader_id, reader_position);
                reclaim_consumed_prefix(&mut state);
                return Ok(Some(chunk));
            }
            if let Some(error) = &state.error {
                return Err(Exception::throw_message(ctx, error));
            }
            if state.finished {
                return Ok(None);
            }
        }

        let native = shared.borrow_mut().native.take();
        let Some(native) = native else {
            std::future::poll_fn(|cx| {
                let mut state = shared.borrow_mut();
                let position = state.reader_positions[&reader.reader_id];
                if position < state.buffer_start + state.buffer.len() - state.buffer_head
                    || state.error.is_some()
                    || state.finished
                    || state.native.is_some()
                {
                    Poll::Ready(())
                } else {
                    if !state
                        .waiters
                        .iter()
                        .any(|waker| waker.will_wake(cx.waker()))
                    {
                        state.waiters.push(cx.waker().clone());
                    }
                    Poll::Pending
                }
            })
            .await;
            continue;
        };

        let mut lease = NativeLease {
            native: Some(native),
            shared: shared.clone(),
        };
        let outcome = lease
            .native
            .as_mut()
            .expect("native response body lease is present")
            .read_chunk()
            .await;

        let native = lease.native.take();
        let (result, waiters) = {
            let mut state = shared.borrow_mut();
            let result = match outcome {
                Ok(Some(chunk)) => {
                    state.buffer.extend_from_slice(&chunk);
                    state.native = native;
                    Ok(())
                }
                Ok(None) => {
                    state.finished = true;
                    Ok(())
                }
                Err(error) => {
                    state.error = Some(error.clone());
                    state.finished = true;
                    Err(Exception::throw_message(ctx, &error))
                }
            };
            (result, std::mem::take(&mut state.waiters))
        };
        wake_all(waiters);
        result?;
    }
}

fn reclaim_consumed_prefix<S>(state: &mut SharedBody<S>) {
    let Some(consumed_through) = state.reader_positions.values().copied().min() else {
        state.buffer.clear();
        state.buffer_head = 0;
        return;
    };
    let reclaim = consumed_through.saturating_sub(state.buffer_start);
    if reclaim > 0 {
        state.buffer_start = consumed_through;
        state.buffer_head += reclaim;
        if state.buffer_head == state.buffer.len() {
            state.buffer.clear();
            state.buffer_head = 0;
        } else if state.buffer_head >= 64 * 1024 && state.buffer_head >= state.buffer.len() / 2 {
            state.buffer.drain(..state.buffer_head);
            state.buffer_head = 0;
            #[cfg(test)]
            {
                state.compactions += 1;
            }
        }
    }
}

fn wake_all(waiters: Vec<Waker>) {
    for waiter in waiters {
        waiter.wake();
    }
}

#[cfg(test)]
mod tests {
    use super::{NativeBody, SharedBodyReader, reclaim_consumed_prefix};

    struct TestBody;

    impl NativeBody for TestBody {
        async fn read_chunk(&mut self) -> Result<Option<Vec<u8>>, String> {
            Ok(None)
        }

        fn discard(self) {}
    }

    #[test]
    fn reclaims_prefixes_with_amortized_compaction() {
        let (first, second) = SharedBodyReader::pair(TestBody);
        {
            let mut state = first.shared.borrow_mut();
            state.buffer = vec![0; 1024 * 1024];
            state.reader_positions.insert(first.reader_id, 1024 * 1024);
        }

        for position in (16 * 1024..=1024 * 1024).step_by(16 * 1024) {
            let mut state = first.shared.borrow_mut();
            state.reader_positions.insert(second.reader_id, position);
            reclaim_consumed_prefix(&mut state);
            assert_eq!(
                state.buffer.len() - state.buffer_head,
                1024 * 1024 - position
            );
        }

        let state = first.shared.borrow();
        assert_eq!(state.compactions, 4);
        assert!(state.buffer.is_empty());
    }
}
