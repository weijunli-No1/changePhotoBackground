function request(path, options = {}, onTask) {
  const app = getApp();
  return new Promise((resolve, reject) => {
    const task = wx.request({
      url: `${app.globalData.baseUrl.replace(/\/$/, "")}${path}`,
      timeout: 60000,
      ...options,
      success(res) {
        if (
          res.statusCode >= 200 &&
          res.statusCode < 300 &&
          res.data &&
          typeof res.data.code === "number"
        )
          resolve(res.data);
        else reject(new Error("服务暂不可用，请稍后重试"));
      },
      fail: () => reject(new Error("连接失败，请检查网络后重试")),
    });
    if (onTask) onTask(task);
  });
}
function unwrap(result) {
  if (result.code !== 200) {
    const error = new Error(result.message || "处理失败，请重试");
    error.code = result.code;
    throw error;
  }
  return result.data;
}
function upload(filePath, size, onTask) {
  const app = getApp();
  return new Promise((resolve, reject) => {
    const task = wx.uploadFile({
      url: `${app.globalData.baseUrl.replace(/\/$/, "")}/api/photo/generate-idphoto`,
      filePath,
      name: "file",
      timeout: 120000,
      formData: { height: size.height, width: size.width },
      success(res) {
        try {
          if (res.statusCode < 200 || res.statusCode >= 300)
            throw new Error("图片处理服务暂不可用");
          const data = unwrap(JSON.parse(res.data));
          if (!data || data.status === false)
            throw new Error("请使用仅含一人、面部清晰的正面照片");
          resolve(data);
        } catch (error) {
          reject(error);
        }
      },
      fail: () => reject(new Error("图片上传失败，请检查网络后重试")),
    });
    if (onTask) onTask(task);
  });
}
function watermark(filePath, settings, onTask) {
  return new Promise((resolve, reject) => {
    const task = wx.uploadFile({
      url: `${getApp().globalData.baseUrl.replace(/\/$/, "")}/api/photo/watermark`,
      name: "file",
      filePath,
      timeout: 90000,
      formData: settings,
      success(res) {
        try {
          if (res.statusCode === 404)
            throw Error("水印服务尚未部署，请稍后再试");
          if (res.statusCode < 200 || res.statusCode >= 300)
            throw Error("水印服务暂不可用，请重试");
          const data = unwrap(JSON.parse(res.data));
          if (!data || data.status === false || !data.image_base64)
            throw Error("水印生成失败，请重试");
          resolve(data);
        } catch (error) {
          reject(error);
        }
      },
      fail: () => reject(Error("水印处理连接失败，请检查网络后重试")),
    });
    if (onTask) onTask(task);
  });
}
module.exports = { request, unwrap, upload, watermark };
