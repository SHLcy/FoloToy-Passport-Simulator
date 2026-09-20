// Opt-in compatibility profile for the exact published XiaoZhi play 72 image.
// This provisions only a fresh virtual flash; it never changes the source file.
export const XIAOZHI_IMAGE_SHA256 = '979f01d7fd762c590272017b8e9901e2b473f8a01653c384745a242365b7e923';
export const NVS_OFFSET = 0x9000;
export const NVS_LENGTH = 0x4000;
export async function sha256(bytes) {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map(x => x.toString(16).padStart(2, '0')).join('');
}
export async function supportsVirtualProvisioning(bytes) {
  return bytes.byteLength === 7616373 && await sha256(bytes) === XIAOZHI_IMAGE_SHA256;
}
export async function provisionXiaozhi(bytes, nvs) {
  if (!await supportsVirtualProvisioning(bytes)) throw new Error('此固件版本尚未适配模拟配网');
  if (nvs.byteLength !== NVS_LENGTH || await sha256(nvs) !== '94e4ae871cd6b2b94aae77e677cf4bc46da38f76a8e557ebf0a9bc44de6221db') throw new Error('模拟配网配置校验失败');
  if (!bytes.subarray(NVS_OFFSET, NVS_OFFSET + NVS_LENGTH).every(x => x === 255)) throw new Error('固件已有配置，不能覆盖');
  const copy = new Uint8Array(bytes);
  copy.set(nvs, NVS_OFFSET);
  return copy.buffer;
}
