// formdata-node shim — re-exports the runtime's built-in FormData/File/Blob
export { FormData, formDataToBlob } from '__wasm_rquickjs_builtin/http_form_data';
export { Blob, File } from '__wasm_rquickjs_builtin/http_blob';

import { FormData, formDataToBlob } from '__wasm_rquickjs_builtin/http_form_data';
import { Blob, File } from '__wasm_rquickjs_builtin/http_blob';
export default { FormData, formDataToBlob, Blob, File };
