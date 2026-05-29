// Mirrors Node.js internal/url isURL() shape check.
// It intentionally avoids instanceof checks so URL-like objects from
// other realms/implementations are recognized the same way as Node does.
export function isURL(value) {
    return Boolean(
        value?.href &&
        value.protocol &&
        value.auth === undefined &&
        value.path === undefined,
    );
}

export default { isURL };
