import { validateUploadFile, UPLOAD_MAX_BYTES } from "../uploadValidation";

test("accepts allowed types up to 25 MB", () => {
  expect(validateUploadFile({ name: "a.PDF", size: UPLOAD_MAX_BYTES })).toBeNull();
  expect(validateUploadFile({ name: "a.webp", size: 10 })).toBeNull();
});
test("rejects oversize and unsupported files", () => {
  expect(validateUploadFile({ name: "a.pdf", size: UPLOAD_MAX_BYTES + 1 })).toMatch(/25 MB/);
  expect(validateUploadFile({ name: "a.exe", size: 10 })).toMatch(/Only/);
});
