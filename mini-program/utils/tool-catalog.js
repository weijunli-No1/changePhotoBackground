// 展示与入口共用的工具注册表；新功能需要有真实页面，不能用占位条目上线。
const categories = [
  { id: "portrait", name: "证件照" },
  { id: "image", name: "图片编辑" },
];
const tools = [
  {
    id: "idphoto",
    name: "制作证件照",
    draftName: "证件照草稿",
    description: "考试报名、常用规格与六寸排版",
    category: "portrait",
    keywords: ["一寸", "二寸", "证件照", "排版", "打印", "照片尺寸"],
    icon: "user",
    thumbnail: "/assets/images/sample-portrait.png",
    entry: { type: "portrait" },
    resumePage: "/pages/edit/edit",
    mode: "idphoto",
    featured: {
      title: "证件照，轻松准备",
      description: "考试报名、换底色、六寸排版",
      action: "开始制作",
      image: "/assets/images/sample-female-smile.jpg",
      titleLines: ["证件照，", "轻松准备"],
      photos: [
        { id: "male", src: "/assets/images/sample-male-apricot.jpg" },
        { id: "female", src: "/assets/images/sample-female-smile.jpg" },
      ],
    },
  },
  {
    id: "background",
    name: "更换底色",
    draftName: "更换底色草稿",
    description: "证件照红、蓝、白与自定义底色",
    category: "portrait",
    keywords: ["换背景", "修改背景", "蓝底", "白底", "红底", "换底"],
    icon: "palette",
    entry: { type: "portrait" },
    resumePage: "/pages/edit/edit",
    quick: true,
  },
  {
    id: "exam",
    name: "考试报名照",
    draftName: "考试照片草稿",
    category: "portrait",
    description: "国考、四六级、考研等考试规格",
    keywords: [
      "国考",
      "省考",
      "四六级",
      "考研",
      "教资",
      "报名",
      "考试",
      "注会",
      "法考",
      "计算机",
      "普通话",
    ],
    icon: "education",
    local: true,
    entry: { type: "page", url: "/pages/specs/specs" },
    resumePage: "/pages/exam/exam",
    mode: "exam",
  },
  {
    id: "watermark",
    name: "照片加水印",
    draftName: "水印照片草稿",
    category: "image",
    description: "添加文字、调整透明度与方向",
    keywords: ["水印", "文字", "用途", "复印", "报名"],
    icon: "edit",
    entry: { type: "page", url: "/pages/watermark/watermark" },
    resumePage: "/pages/watermark/watermark",
    mode: "watermark",
  },
  {
    id: "compress",
    name: "图片压缩",
    draftName: "图片压缩草稿",
    description: "调整体积与清晰度",
    category: "image",
    keywords: ["照片", "缩小", "大小", "体积", "kb", "mb", "jpg", "jpeg"],
    icon: "file-zip",
    local: true,
    entry: { type: "page", url: "/pages/tools/tools?mode=compress" },
    resumePage: "/pages/tools/tools",
    mode: "compress",
    quick: true,
  },
  {
    id: "crop",
    name: "裁剪旋转",
    draftName: "裁剪旋转草稿",
    description: "按比例裁剪与校正",
    category: "image",
    keywords: ["照片", "剪裁", "旋转", "构图", "比例", "正方形"],
    icon: "crop",
    local: true,
    entry: { type: "page", url: "/pages/tools/tools?mode=crop" },
    resumePage: "/pages/tools/tools",
    mode: "crop",
    quick: true,
  },
];
function available() {
  return tools.filter((tool) => tool.enabled !== false);
}
function getTool(id) {
  return available().find((tool) => tool.id === id);
}
function getCategories() {
  return categories.filter((group) =>
    available().some((tool) => tool.category === group.id),
  );
}
function findTools(query = "", category = "all") {
  const tokens = String(query)
    .toLowerCase()
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  return available().filter((tool) => {
    const group = categories.find((item) => item.id === tool.category);
    const text = [
      tool.name,
      tool.description,
      group && group.name,
      ...(tool.keywords || []),
    ]
      .join(" ")
      .toLowerCase();
    return (
      (category === "all" || tool.category === category) &&
      tokens.every((token) => text.includes(token))
    );
  });
}
function grouped(query = "", category = "all") {
  const matches = findTools(query, category);
  return getCategories()
    .map((group) => ({
      ...group,
      tools: matches.filter((tool) => tool.category === group.id),
    }))
    .filter((group) => group.tools.length);
}
function featuredTool() {
  return available().find((tool) => tool.featured);
}
function quickTools() {
  return available()
    .filter((tool) => tool.quick)
    .slice(0, 3);
}
function draftTool(draft) {
  return (
    getTool(draft.toolId) ||
    available().find((tool) => tool.mode && tool.mode === draft.mode)
  );
}
function draftUrl(draft) {
  const tool = draftTool(draft);
  return tool && tool.resumePage && draft.id
    ? `${tool.resumePage}?draft=${encodeURIComponent(draft.id)}`
    : "";
}
function presentDraft(draft, now = Date.now()) {
  const tool = draftTool(draft);
  let updatedLabel = "保存在当前设备";
  if (Number.isFinite(draft.updatedAt) && draft.updatedAt > 0) {
    const elapsed = Math.max(0, now - draft.updatedAt);
    if (elapsed < 60000) updatedLabel = "刚刚编辑";
    else if (elapsed < 3600000)
      updatedLabel = `${Math.floor(elapsed / 60000)}分钟前编辑`;
    else {
      const date = new Date(draft.updatedAt);
      updatedLabel = `${date.getMonth() + 1}月${date.getDate()}日编辑`;
    }
  }
  return {
    ...draft,
    displayPath:
      draft.previewPath ||
      (["idphoto", "exam"].includes(draft.mode)
        ? draft.sourcePath
        : draft.resultPath || draft.sourcePath),
    title: tool ? tool.draftName || `${tool.name}草稿` : "本地作品草稿",
    updatedLabel,
  };
}
module.exports = {
  categories,
  tools,
  available,
  getTool,
  getCategories,
  findTools,
  grouped,
  quickTools,
  featuredTool,
  draftUrl,
  presentDraft,
};
