export function initializeIncomingMessage(message, socket) {
    message.complete = false;
    message.socket = socket;
    message.connection = socket;
    message.client = socket;
    message.trailers = {};
    message.trailersDistinct = {};
    message.rawTrailers = [];
    message.aborted = false;
    message._consuming = false;
    message._dumped = false;
    message._timeout = null;
}
