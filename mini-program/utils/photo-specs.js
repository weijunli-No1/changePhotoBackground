const sizes = [
  { name: "一寸", width: 295, height: 413, note: "常用证件照" },
  { name: "二寸", width: 413, height: 579, note: "常用证件照" },
  { name: "小一寸", width: 260, height: 378, note: "小尺寸证件照" },
  { name: "小二寸", width: 390, height: 567, note: "小尺寸证件照" },
];
function validateSize(width, height) {
  const w = Number(width),
    h = Number(height);
  if (
    !Number.isInteger(w) ||
    !Number.isInteger(h) ||
    w < 100 ||
    h < 100 ||
    w > 3000 ||
    h > 3000
  ) {
    throw new Error("宽和高需为100至3000之间的整数");
  }
  return { name: "自定义", width: w, height: h };
}
// 考试规格与出处独立维护，尺寸下限、比例和建议输出不能混为一谈。
const categories = [
  { id: "all", name: "全部" },
  { id: "recruit", name: "公务招录" },
  { id: "education", name: "学历语言" },
  { id: "qualification", name: "资格职称" },
  { id: "common", name: "常用尺寸" },
];
const reviewedAt = "2026-10-26";
const cptaSource =
  "https://ks.rst.gansu.gov.cn/ncms/article_116b9dc6102ef9aa85b2b433fef45354.shtml";
function preset(id, name, category, width, height, extra = {}) {
  return {
    id,
    name,
    category,
    width,
    height,
    dimensionLabel: `${width} × ${height} px`,
    sizeRule: "固定像素",
    background: "以报名通知为准",
    format: "JPG / JPEG",
    fileRule: "以报名系统要求为准",
    notice: "请核对当次报名通知；尺寸适配不代表通过人像及资格审核。",
    sourceLabel: "",
    sourceUrl: "",
    reviewedAt,
    keywords: [],
    ...extra,
  };
}
const presets = [
  preset("national-civil", "国家公务员考试", "recruit", 295, 413, {
    popular: true,
    keywords: ["国考", "公务员", "2027", "报名确认"],
    sizeRule: "像素下限",
    dimensionLabel: "宽≥295 · 高≥413 px",
    background: "白色或蓝色",
    sourceLabel: "2027年度国考报考指南 · 国家税务总局上海市税务局转载",
    sourceUrl: "https://shanghai.chinatax.gov.cn/xxgk/rsxx/202610/t481764.html",
    notice:
      "不得美化、修饰。此处只适配原图尺寸，之后仍须使用国考官方照片处理工具审核并保存。",
  }),
  preset("cet4", "大学英语四级", "education", 144, 192, {
    popular: true,
    keywords: ["四级", "四六级", "CET4", "CET-4", "英语"],
    sizeRule: "参考像素下限",
    dimensionLabel: "参考：宽≥144 · 高≥192 px",
    background: "白色或浅蓝色，按学校通知",
    maxKB: 200,
    fileRule: "参考学校：不超过200 KB",
    sourceLabel: "中国农业科学院研究生院2026年下半年四六级通知",
    sourceUrl: "https://gs.caas.cn/tzgg/a01ae00f4cc5462494e73638805f0f1e.htm",
    notice:
      "依据所列2026年学校通知整理。其他学校的底色、体积、命名和采集方式可能不同，请先核对本校当次要求。",
  }),
  preset("cet6", "大学英语六级", "education", 144, 192, {
    popular: true,
    keywords: ["六级", "四六级", "CET6", "CET-6", "英语"],
    sizeRule: "参考像素下限",
    dimensionLabel: "参考：宽≥144 · 高≥192 px",
    background: "白色或浅蓝色，按学校通知",
    maxKB: 200,
    fileRule: "参考学校：不超过200 KB",
    sourceLabel: "中国农业科学院研究生院2026年下半年四六级通知",
    sourceUrl: "https://gs.caas.cn/tzgg/a01ae00f4cc5462494e73638805f0f1e.htm",
    notice:
      "依据所列2026年学校通知整理。其他学校的底色、体积、命名和采集方式可能不同，请先核对本校当次要求。",
  }),
  preset("postgraduate", "考研报名照片", "education", 600, 800, {
    popular: true,
    keywords: ["研究生", "考研", "硕士", "研考", "网上确认", "2027"],
    sizeRule: "宽高比例 3:4",
    dimensionLabel: "3:4 比例 · 建议输出600 × 800 px",
    maxKB: 10240,
    fileRule: "参考报考点：建议不超过10 MB",
    background: "以本人报考点公告为准",
    sourceLabel: "河北科技师范学院报考点2027年报名公告",
    sourceUrl: "https://www.hevttc.edu.cn/info/1010/31635.htm",
    notice:
      "600×800是本工具的输出预设，并非全国统一像素标准。不得修改人像特征，不提供美颜、换底或水印；如要求专用采集，请直接使用官方渠道。",
  }),
  preset("teacher-exam", "中小学教师资格考试", "qualification", 300, 400, {
    popular: true,
    keywords: ["教资", "教师资格证", "笔试", "面试"],
    sizeRule: "建议输出尺寸",
    dimensionLabel: "建议输出300 × 400 px",
    background: "白色",
    maxKB: 200,
    fileRule: "不超过200 KB",
    sourceLabel: "北京市2026年下半年教师资格笔试报名通知",
    sourceUrl:
      "https://www.beijing.gov.cn/fuwu/bmfw/sy/jrts/tzxx/202606/t20260630_4739402.html",
    notice:
      "该通知未限定固定像素，300×400是本工具预设。请使用近6个月白底免冠原照，不得美颜或使用特效；面试以当地通知为准。",
  }),
  preset("fujian-civil", "福建省公务员考试", "recruit", 295, 413, {
    keywords: ["省考", "福建", "公务员", "2026"],
    sizeRule: "像素下限",
    dimensionLabel: "宽≥295 · 高≥413 px",
    background: "白色或蓝色",
    sourceLabel: "福建省2026年公务员报考操作指南",
    sourceUrl: "https://gwykl.fujian.gov.cn/portal/help2026/s4.htm",
    notice:
      "不得将像素不足的照片放大后使用。还须使用当地官方照片工具处理；其他省份请核对本省通知。",
  }),
  preset("anhui-institution", "安徽事业单位招聘", "recruit", 295, 413, {
    keywords: ["事业编", "事业单位", "安徽", "2026"],
    format: "JPG",
    sourceLabel: "五河县2026年事业单位招聘公告",
    sourceUrl: "https://www.wuhe.gov.cn/xwzx/tzgg/81372348.html",
    notice:
      "适用于所列安徽2026年招聘公告的尺寸；其他地区事业单位招聘要求并不统一。",
  }),
  preset("ncre", "全国计算机等级考试", "education", 144, 192, {
    keywords: [
      "NCRE",
      "计算机一级",
      "计算机二级",
      "计算机三级",
      "计算机四级",
      "计算机等级",
    ],
    sizeRule: "像素下限",
    dimensionLabel: "宽≥144 · 高≥192 px",
    minKB: 20,
    maxKB: 200,
    fileRule: "20—200 KB",
    sourceLabel: "吉林建筑大学2026年上半年NCRE报名通知",
    sourceUrl: "https://jwc.jlju.edu.cn/info/1551/14301.htm",
    notice:
      "照片用于证书，须真实反映本人相貌，避免过度美化。底色以考点当次要求为准。",
  }),
  preset("pets", "全国英语等级考试", "education", 390, 567, {
    keywords: ["PETS", "公共英语", "全国英语"],
    sizeRule: "33 × 48 mm参考换算",
    dimensionLabel: "33 × 48 mm · 参考390 × 567 px",
    minKB: 10,
    maxKB: 50,
    fileRule: "10—50 KB",
    background: "白色或蓝色",
    sourceLabel: "中国教育考试网PETS考生须知",
    sourceUrl: "https://pets.neea.edu.cn/html1/folder/1507/1557-1.htm",
    notice: "公告给出毫米尺寸；像素按300 DPI参考换算，最终以报名系统要求为准。",
  }),
  preset("mandarin", "普通话水平测试", "education", 390, 567, {
    keywords: ["普通话", "PSC", "普通话证"],
    background: "白色",
    maxKB: 300,
    fileRule: "参考考点：300 KB以内",
    sourceLabel: "柳州职业技术大学2026年9月普通话测试公告",
    sourceUrl: "https://www.lzpu.edu.cn/jxjy/tzgg/tsxm/content_107507",
    notice:
      "不同测试站体积要求可能不同。须使用近6个月标准证件原照，不能使用生活照、美颜照或自拍照。",
  }),
  preset("cpa", "注册会计师考试", "qualification", 178, 220, {
    popular: true,
    keywords: ["CPA", "注会", "会计"],
    background: "白色",
    minKB: 2,
    maxKB: 20,
    fileRule: "2—20 KB",
    sourceLabel: "中注协2026年网报答疑",
    sourceUrl:
      "https://cpaexam.cicpa.org.cn/files/articlehtml/statichtml/03/0000019D41B6B2EF69638694586F24FE.html",
    notice:
      "使用最近1年正面免冠白底原照，分辨率须至少96 DPI。工具会写入300 DPI标记；仍需核对人像、文件大小等要求。",
  }),
  preset("legal", "国家统一法律职业资格考试", "qualification", 413, 626, {
    keywords: ["法考", "司法考试", "法律职业资格"],
    background: "红色、蓝色或白色",
    minKB: 40,
    maxKB: 100,
    fileRule: "40—100 KB（广州2026年指引）",
    sourceLabel: "广州市司法局2026年法考报名指引",
    sourceUrl: "https://sfj.gz.gov.cn/webUI/BaoMing/BaoMingnet1.aspx",
    notice:
      "使用近3个月正面免冠证件原照，须显露双眉、双耳、双肩，不得美颜、拉伸或裁剪生活照。",
  }),
  preset("accounting", "会计专业技术资格考试", "qualification", 295, 413, {
    keywords: ["初级会计", "中级会计", "高级会计", "会计职称"],
    background: "白色",
    minKB: 11,
    sizeRule: "像素下限",
    dimensionLabel: "宽≥295 · 高≥413 px",
    fileRule: "源照片大于10 KB",
    sourceLabel: "上海市财政局2026年会计资格报名答疑",
    sourceUrl:
      "https://czj.sh.gov.cn/zys_8908/zcjd_8969/qt_8982/20251230/xxfboswf0000003512.html",
    notice:
      "依据所列上海考区初级、高级报名说明整理；中级及其他地区以当次公告为准。还须使用官方照片审核工具处理。",
  }),
  preset("teacher-recognition", "教师资格认定", "qualification", 295, 413, {
    keywords: ["教资认定", "教师认定"],
    sizeRule: "一寸参考换算",
    background: "白色",
    sourceLabel: "中国教师资格网2026年照片上传答疑",
    sourceUrl: "https://www.jszg.edu.cn/pages/html/102/a21153.html",
    notice:
      "参考全国系统的一寸白底要求；认定机构可能另需不同尺寸的纸质照片，请核对当地通知。",
  }),
];
const professionalExams = [
  ["constructor", "一级建造师", ["一建", "建造师"]],
  ["cost-engineer", "一级造价工程师", ["一造", "造价师"]],
  ["supervision", "监理工程师", ["监理"]],
  ["safety", "中级注册安全工程师", ["注安", "安全工程师"]],
  ["fire", "一级注册消防工程师", ["一消", "消防"]],
  ["pharmacist", "执业药师", ["药师"]],
  ["economist", "经济专业技术资格", ["初级经济师", "中级经济师", "高级经济师"]],
  ["social-worker", "社会工作者职业资格", ["社工", "社工证", "助理社会工作师"]],
  ["translator", "翻译专业资格", ["CATTI", "翻译证", "笔译", "口译"]],
  ["publishing", "出版专业技术资格", ["出版资格"]],
  ["audit", "审计专业技术资格", ["审计师"]],
  ["statistics", "统计专业技术资格", ["统计师"]],
  ["consulting", "咨询工程师（投资）", ["咨询工程师"]],
  ["surveying", "注册测绘师", ["测绘"]],
  ["planner", "注册城乡规划师", ["城乡规划师"]],
  ["environment", "环境影响评价工程师", ["环评", "环评师"]],
  ["metrology", "注册计量师", ["计量"]],
  ["equipment", "设备监理师", ["设备监理"]],
];
professionalExams.forEach(([id, name, keywords]) =>
  presets.push(
    preset(id, name, "qualification", 295, 413, {
      keywords,
      background: "白色",
      sizeRule: "报名平台参考规格",
      sourceLabel: "甘肃人事考试网2026年全国专业技术资格照片工具说明",
      sourceUrl: cptaSource,
      notice:
        "本项采用全国专业技术资格报名平台的通用照片模板，并非单独考试当年的全部要求。须核对本省当次考试公告，并用官方照片审核处理工具审核。",
    }),
  ),
);
sizes.forEach((size, index) =>
  presets.push(
    preset(`common-${index}`, size.name, "common", size.width, size.height, {
      background: "可选白、蓝、红或自定义",
      sizeRule: "常用像素模板",
      keywords: [size.name, "证件照", "打印"],
      notice:
        "像素为常用输出模板；实际打印尺寸与DPI有关，具体用途请按接收方要求选择。",
    }),
  ),
);
function getSpec(id) {
  return presets.find((item) => item.id === id);
}
function findSpecs(query = "", category = "all") {
  const tokens = String(query)
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
  return presets.filter(
    (item) =>
      (category === "all" || item.category === category) &&
      tokens.every((token) =>
        [item.name, item.id, item.dimensionLabel, ...item.keywords]
          .join(" ")
          .toLowerCase()
          .includes(token),
      ),
  );
}
module.exports = {
  sizes,
  validateSize,
  categories,
  presets,
  getSpec,
  findSpecs,
};
