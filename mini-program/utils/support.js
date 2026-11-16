const faqs = [
  {
    id: "photo",
    title: "照片制作失败，怎么办？",
    answer:
      "先检查网络，再使用单人、正面、面部清晰的照片重试。避免脸部被头发、帽子或其他物体遮挡。编辑内容会尽量保留为本机草稿，可在“作品”中继续。",
  },
  {
    id: "album",
    title: "提示保存成功，但相册里找不到？",
    answer:
      "请在手机相册的最近项目中查找。如果提示相册权限不足，按保存页面的指引打开设置并授权，再次点击保存。相册写入失败时重试原次保存不重复扣次；保存成功后再次主动保存，会重新校验并使用保存次数。",
  },
  {
    id: "ad",
    title: "保存次数和视频广告怎么计算？",
    answer:
      "每天有5次免费证件照保存机会。完整观看一次激励视频增加一次，当天完整观看达到5次后可不限次数保存，以服务端显示的额度为准。查看、放大和长按得到的是水印预览；导出或从云端作品保存无水印照片都需校验次数。本地压缩、裁剪不占用证件照次数。广告未播放完成时不会增加次数，照片会保留。",
  },
  {
    id: "draft",
    title: "退出登录会丢失照片和草稿吗？",
    answer:
      "退出登录会隐藏账号资料和云端作品，但不会删除本机草稿、头像昵称或已保存到手机相册的照片。再次登录同一账号可恢复本机资料。最近8份草稿只保存在当前设备，不会自动同步到其他手机。",
  },
  {
    id: "profile",
    title: "如何修改头像和昵称？",
    answer:
      "登录后，在“我的”点击头像或“编辑头像昵称”。选择头像、填写昵称后点击保存。资料按账号保存在当前设备，在作品页清理本地草稿不会删除这些资料。",
  },
];
function deviceSummary(sdk) {
  let device = {},
    base = {},
    account = {};
  try {
    device = sdk.getDeviceInfo ? sdk.getDeviceInfo() : {};
  } catch (error) {}
  try {
    base = sdk.getAppBaseInfo ? sdk.getAppBaseInfo() : {};
  } catch (error) {}
  try {
    account = sdk.getAccountInfoSync
      ? sdk.getAccountInfoSync().miniProgram || {}
      : {};
  } catch (error) {}
  const environment =
    { develop: "开发预览", trial: "体验版", release: "正式版" }[
      account.envVersion
    ] || "未知";
  return [
    "拾光小相 · 问题反馈",
    `小程序版本：${account.version || environment}`,
    `设备：${device.brand || ""} ${device.model || "未知"}`.trim(),
    `系统：${device.system || device.platform || "未知"}`,
    `微信版本：${base.version || "未知"}`,
    `基础库：${base.SDKVersion || "未知"}`,
    "遇到的问题：",
    "操作步骤：",
  ].join("\n");
}
module.exports = { faqs, deviceSummary };
