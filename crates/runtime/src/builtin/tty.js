// node:tty stub implementation
// In WASM, there is no real TTY — isatty always returns false.

import net from 'node:net';

const COLORS_2 = 1;
const COLORS_16 = 4;
const COLORS_256 = 8;
const COLORS_16m = 24;

function getColorDepth(env) {
    const currentEnv = env || process.env || {};

    if (currentEnv.FORCE_COLOR !== undefined) {
        switch (currentEnv.FORCE_COLOR) {
            case '':
            case '1':
            case 'true':
                return COLORS_16;
            case '2':
                return COLORS_256;
            case '3':
                return COLORS_16m;
            default:
                return COLORS_2;
        }
    }

    if (currentEnv.NODE_DISABLE_COLORS !== undefined ||
        currentEnv.NO_COLOR !== undefined ||
        currentEnv.TERM === 'dumb') {
        return COLORS_2;
    }

    return this && this.isTTY ? COLORS_16 : COLORS_2;
}

export function isatty(fd) {
    return false;
}

export function ReadStream(fd, options) {
    if (!(this instanceof ReadStream))
        return new ReadStream(fd, options);
    this.isTTY = false;
    this.fd = fd;
    this.isRaw = false;
}

Object.setPrototypeOf(ReadStream.prototype, net.Socket.prototype);
Object.setPrototypeOf(ReadStream, net.Socket);

ReadStream.prototype.setRawMode = function setRawMode(mode) {
    return this;
};

export function WriteStream(fd) {
    if (!(this instanceof WriteStream))
        return new WriteStream(fd);
    this.isTTY = false;
    this.fd = fd;
    this.columns = 80;
    this.rows = 24;
}

Object.setPrototypeOf(WriteStream.prototype, net.Socket.prototype);
Object.setPrototypeOf(WriteStream, net.Socket);

WriteStream.prototype.getColorDepth = getColorDepth;

WriteStream.prototype.hasColors = function hasColors(count, env) {
    if (env === undefined &&
        (count === undefined || (typeof count === 'object' && count !== null))) {
        env = count;
        count = 16;
    }
    return count <= 2 ** this.getColorDepth(env);
};

WriteStream.prototype.getWindowSize = function getWindowSize() {
    return [this.columns, this.rows];
};

WriteStream.prototype.clearLine = function clearLine(dir, callback) {
    if (typeof callback === 'function') callback();
};

WriteStream.prototype.cursorTo = function cursorTo(x, y, callback) {
    if (typeof callback === 'function') callback();
};

WriteStream.prototype.moveCursor = function moveCursor(dx, dy, callback) {
    if (typeof callback === 'function') callback();
};

WriteStream.prototype.clearScreenDown = function clearScreenDown(callback) {
    if (typeof callback === 'function') callback();
};

export default {
    isatty,
    ReadStream,
    WriteStream,
};
