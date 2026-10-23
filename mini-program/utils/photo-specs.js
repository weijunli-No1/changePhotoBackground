const sizes = [
  { name: '一寸', width: 295, height: 413, note: '常用证件照' },
  { name: '二寸', width: 413, height: 579, note: '常用证件照' },
  { name: '小一寸', width: 260, height: 378, note: '小尺寸证件照' },
  { name: '小二寸', width: 390, height: 567, note: '小尺寸证件照' },
];
function validateSize(width, height) {
  const w = Number(width),
    h = Number(height);
  if (!Number.isInteger(w) || !Number.isInteger(h) || w < 100 || h < 100 || w > 3000 || h > 3000) {
    throw new Error('宽和高需为100至3000之间的整数');
  }
  return { name: '自定义', width: w, height: h };
}
module.exports = { sizes, validateSize };
