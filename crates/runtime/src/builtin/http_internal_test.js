Object.defineProperties(Response.prototype, {
    pauseNextBodyReadAfterReadyForTest: {
        value() {
            return httpNative.pauseNextBodyReadAfterReadyForTest(this.nativeResponse);
        },
    },
    takeRecoveredBodyReadBytesForTest: {
        value() {
            return httpNative.takeRecoveredBodyReadBytesForTest(this.nativeResponse);
        },
    },
});
