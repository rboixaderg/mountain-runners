// Why an attachment was refused. The reasons are shared by the validator, the
// destination, the service composition and the public reports, so a trace or a
// message can never name a reason that no code produces.

export const attachmentRefusalReasons = {
  unsupportedType: "unsupported_type",
  damagedImage: "damaged_image",
  fakeType: "fake_type",
  tooLarge: "too_large",
  downloadFailed: "download_failed",
  scaleFailed: "scale_failed",
};
