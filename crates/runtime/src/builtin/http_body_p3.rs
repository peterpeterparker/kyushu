//! Shared Preview 3 response-body ownership for `fetch` and `node:http`.

use std::cell::RefCell;
use std::future::{Future, IntoFuture};
use std::pin::Pin;
use std::rc::Rc;
use std::task::{Context, Poll};
use wasip3::http::types::{ErrorCode, Response, Trailers};
use wasip3::wit_bindgen::rt::async_support::{
    FutureReader, FutureWriter, StreamRead, StreamReader, StreamResult,
};

type BodyResultReader = FutureReader<Result<Option<Trailers>, ErrorCode>>;
type BodyResultFuture = Pin<Box<<BodyResultReader as IntoFuture>::IntoFuture>>;
type ResponseResultWriter = FutureWriter<Result<(), ErrorCode>>;
#[derive(Default)]
struct RecoveredReadState {
    outcome: Option<(StreamResult, Vec<u8>)>,
    #[cfg(feature = "internal-test-execution")]
    recovered_bytes_for_test: usize,
    #[cfg(feature = "internal-test-execution")]
    pause_ready_for_test: bool,
}

type RecoveredRead = Rc<RefCell<RecoveredReadState>>;

struct CancelSafeRead<'a> {
    read: Pin<Box<StreamRead<'a, u8>>>,
    recovered: RecoveredRead,
    #[cfg(feature = "internal-test-execution")]
    ready_for_test: Option<(StreamResult, Vec<u8>)>,
    completed: bool,
}

impl<'a> CancelSafeRead<'a> {
    fn new(read: StreamRead<'a, u8>, recovered: RecoveredRead) -> Self {
        Self {
            read: Box::pin(read),
            recovered,
            #[cfg(feature = "internal-test-execution")]
            ready_for_test: None,
            completed: false,
        }
    }
}

impl Future for CancelSafeRead<'_> {
    type Output = (StreamResult, Vec<u8>);

    fn poll(mut self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<Self::Output> {
        #[cfg(feature = "internal-test-execution")]
        if self.ready_for_test.is_some() {
            return Poll::Pending;
        }
        match self.read.as_mut().poll(cx) {
            Poll::Ready(result) => {
                #[cfg(feature = "internal-test-execution")]
                {
                    let pause_ready_for_test = {
                        let mut recovered = self.recovered.borrow_mut();
                        std::mem::take(&mut recovered.pause_ready_for_test)
                    };
                    if pause_ready_for_test {
                        self.ready_for_test = Some(result);
                        return Poll::Pending;
                    }
                }
                self.completed = true;
                Poll::Ready(result)
            }
            Poll::Pending => Poll::Pending,
        }
    }
}

impl Drop for CancelSafeRead<'_> {
    fn drop(&mut self) {
        if !self.completed {
            #[cfg(feature = "internal-test-execution")]
            let recovered = self
                .ready_for_test
                .take()
                .unwrap_or_else(|| self.read.as_mut().cancel());
            #[cfg(not(feature = "internal-test-execution"))]
            let recovered = self.read.as_mut().cancel();
            let mut state = self.recovered.borrow_mut();
            #[cfg(feature = "internal-test-execution")]
            {
                state.recovered_bytes_for_test += recovered.1.len();
            }
            state.outcome = Some(recovered);
        }
    }
}

enum ResponseBodyState {
    Unconsumed(Response),
    Reading {
        reader: StreamReader<u8>,
        result: BodyResultReader,
        response_result: ResponseResultWriter,
    },
    Finishing {
        result: BodyResultFuture,
        response_result: Option<ResponseResultWriter>,
    },
    Consumed,
}

/// Owns a native Preview 3 response until its body reaches EOF or is deliberately discarded.
///
/// A cancelled `read_chunk` future leaves the current state in this owner. This lets a surviving
/// clone resume a shared body after another clone cancels its pending read. Deliberate disposal of
/// the owner still drops the reader, body-result future, response-result writer, and response.
pub(crate) struct ResponseBody {
    state: ResponseBodyState,
    recovered_read: RecoveredRead,
}

impl ResponseBody {
    pub(crate) fn empty() -> Self {
        Self {
            state: ResponseBodyState::Consumed,
            recovered_read: Rc::new(RefCell::new(RecoveredReadState::default())),
        }
    }

    pub(crate) fn new(response: Response) -> Self {
        Self {
            state: ResponseBodyState::Unconsumed(response),
            recovered_read: Rc::new(RefCell::new(RecoveredReadState::default())),
        }
    }

    pub(crate) fn discard(&mut self) {
        self.state = ResponseBodyState::Consumed;
    }

    #[cfg(feature = "internal-test-execution")]
    pub(crate) fn take_recovered_read_bytes_for_test(&self) -> usize {
        std::mem::take(&mut self.recovered_read.borrow_mut().recovered_bytes_for_test)
    }

    #[cfg(feature = "internal-test-execution")]
    pub(crate) fn pause_next_ready_read_for_test(&self) -> bool {
        self.recovered_read.borrow_mut().pause_ready_for_test = true;
        true
    }

    pub(crate) async fn read_chunk(&mut self) -> Result<Option<Vec<u8>>, String> {
        if matches!(self.state, ResponseBodyState::Unconsumed(_)) {
            let ResponseBodyState::Unconsumed(response) =
                std::mem::replace(&mut self.state, ResponseBodyState::Consumed)
            else {
                unreachable!();
            };
            let (response_result, response_result_reader) =
                wasip3::wit_future::new(|| Ok::<(), ErrorCode>(()));
            let (reader, result) = Response::consume_body(response, response_result_reader);
            self.state = ResponseBodyState::Reading {
                reader,
                result,
                response_result,
            };
        }

        match &self.state {
            ResponseBodyState::Reading { .. } => self.read_from_reader().await,
            ResponseBodyState::Finishing { .. } => self.finish().await,
            ResponseBodyState::Consumed => Ok(None),
            ResponseBodyState::Unconsumed(_) => unreachable!(),
        }
    }

    async fn read_from_reader(&mut self) -> Result<Option<Vec<u8>>, String> {
        const CHUNK_SIZE: usize = 16 * 1024;
        loop {
            let recovered = self.recovered_read.borrow_mut().outcome.take();
            let (status, bytes) = if let Some(recovered) = recovered {
                recovered
            } else {
                let recovered_read = self.recovered_read.clone();
                let ResponseBodyState::Reading { reader, .. } = &mut self.state else {
                    return Ok(None);
                };
                CancelSafeRead::new(reader.read(Vec::with_capacity(CHUNK_SIZE)), recovered_read)
                    .await
            };
            match status {
                StreamResult::Complete(_) if !bytes.is_empty() => return Ok(Some(bytes)),
                StreamResult::Complete(_) => continue,
                StreamResult::Dropped => {
                    let ResponseBodyState::Reading {
                        reader,
                        result,
                        response_result,
                    } = std::mem::replace(&mut self.state, ResponseBodyState::Consumed)
                    else {
                        unreachable!();
                    };
                    drop(reader);
                    self.state = ResponseBodyState::Finishing {
                        result: Box::pin(result.into_future()),
                        response_result: Some(response_result),
                    };
                    return if bytes.is_empty() {
                        self.finish().await
                    } else {
                        Ok(Some(bytes))
                    };
                }
                StreamResult::Cancelled => continue,
            }
        }
    }

    async fn finish(&mut self) -> Result<Option<Vec<u8>>, String> {
        let outcome = {
            let ResponseBodyState::Finishing {
                result,
                response_result,
            } = &mut self.state
            else {
                return Ok(None);
            };
            drop(response_result.take());
            result.as_mut().await
        };
        self.state = ResponseBodyState::Consumed;
        match outcome {
            Ok(_) => Ok(None),
            Err(error) => Err(format!("HTTP response body error: {error:?}")),
        }
    }
}
