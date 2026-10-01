const input = document.getElementById("group-input");
const button = document.getElementById("download-button");
const status = document.getElementById("status");
const widthInput = document.getElementById("svg-width");
const heightInput = document.getElementById("svg-height");
const SVG_NAMESPACE = "http://www.w3.org/2000/svg";

function positiveDimension(value, label) {
  const dimension = Number(value);
  if (!Number.isFinite(dimension) || dimension <= 0) throw new Error(`${label} 必須是正數。`);
  return dimension;
}

function svgFromGroup(markup, width, height) {
  const svgWidth = positiveDimension(width, "SVG 寬度");
  const svgHeight = positiveDimension(height, "SVG 高度");
  const source = markup.trim();
  if (!source) throw new Error("請先貼上 <g> 元素。");

  const documentFromInput = new DOMParser().parseFromString(
    `<svg xmlns="${SVG_NAMESPACE}">${source}</svg>`,
    "image/svg+xml"
  );
  if (documentFromInput.querySelector("parsererror")) {
    throw new Error("貼上的內容不是有效 XML。");
  }

  const wrapper = documentFromInput.documentElement;
  const elements = [...wrapper.children];
  if (elements.length !== 1 || elements[0].localName !== "g") {
    throw new Error("內容必須剛好是一個 <g> 元素。");
  }

  const group = new XMLSerializer().serializeToString(elements[0]);
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="${SVG_NAMESPACE}" width="${svgWidth}" height="${svgHeight}" version="1.1">
  ${group}
</svg>
`;
}

function downloadSvg(svgText) {
  const blob = new Blob([svgText], { type: "image/svg+xml;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "group.svg";
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

button.addEventListener("click", () => {
  try {
    downloadSvg(svgFromGroup(input.value, widthInput.value, heightInput.value));
    status.textContent = "SVG 已下載。";
  } catch (error) {
    status.textContent = error.message;
  }
});
