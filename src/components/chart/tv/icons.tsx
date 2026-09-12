import type { SVGProps } from "react";

const base: SVGProps<SVGSVGElement> = {
  width: 28, height: 28, viewBox: "0 0 28 28", fill: "none", stroke: "currentColor",
  strokeWidth: 1.2, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": true,
};
const Svg = ({ d, ...p }: { d: string } & SVGProps<SVGSVGElement>) => (
  <svg {...base} {...p}><path d={d} /></svg>
);

export const IconCross = () => <Svg d="M14 6v16M6 14h16" />;
export const IconTrend = () => <Svg d="M7 21 21 7M7 21a1.5 1.5 0 1 0 0-.01M21 7a1.5 1.5 0 1 0 0-.01" />;
export const IconHLine = () => <Svg d="M4 14h20M14 14a1.5 1.5 0 1 0 0-.01" />;
export const IconVLine = () => <Svg d="M14 4v20M14 14a1.5 1.5 0 1 0 0-.01" />;
export const IconRay = () => <Svg d="M7 20 24 8M7 20a1.5 1.5 0 1 0 0-.01" />;
export const IconFib = () => <Svg d="M4 7h20M4 11.5h20M4 16h20M4 20.5h20M7 7l2 13.5" />;
export const IconFibExt = () => <Svg d="M5 22 12 10l5 6 6-10M5 8h18" />;
export const IconChannel = () => <Svg d="M5 18 19 6M9 22 23 10" />;
export const IconRect = () => <Svg d="M6 8h16v12H6z" />;
export const IconText = () => <Svg d="M8 8h12M14 8v13M11 21h6" />;
export const IconMeasure = () => <Svg d="M5 19 19 5l4 4L9 23zM9 15l2 2M12 12l2 2M15 9l2 2" />;
export const IconTrade = () => <Svg d="M6 20h16M6 14h16M6 8h16M9 14v6M19 8v6" />;
export const IconTrash = () => <Svg d="M8 9h12M11 9V7h6v2M9.5 9l.8 12h7.4l.8-12" />;
export const IconDelete = () => <Svg d="M9 9l10 10M19 9 9 19" />;
export const IconUndo = () => <Svg d="M10 9 6 13l4 4M6 13h11a5 5 0 0 1 0 10h-3" />;
export const IconRedo = () => <Svg d="m18 9 4 4-4 4M22 13H11a5 5 0 0 0 0 10h3" />;
export const IconPlus = () => <Svg d="M14 8v12M8 14h12M14 23a9 9 0 1 0 0-18 9 9 0 0 0 0 18" />;
export const IconSearch = () => <Svg d="M12.5 19a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13M17.5 17.5 22 22" />;
export const IconIndicators = () => <Svg d="M5 21 10 13l4 4 7-10M17 7h4v4" />;
export const IconAlert = () => <Svg d="M14 22a8 8 0 1 0 0-16 8 8 0 0 0 0 16M14 10v4l3 2M7 5 4.5 7.5M21 5l2.5 2.5" />;
export const IconLayout = () => <Svg d="M6 6h7v7H6zM15 6h7v7h-7zM6 15h7v7H6zM15 15h7v7h-7z" />;
export const IconGear = () => <Svg d="M14 17.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7M14 5v2.5M14 20.5V23M5 14h2.5M20.5 14H23M7.6 7.6l1.8 1.8M18.6 18.6l1.8 1.8M7.6 20.4l1.8-1.8M18.6 9.4l1.8-1.8" />;
export const IconFullscreen = () => <Svg d="M6 11V6h5M17 6h5v5M22 17v5h-5M11 22H6v-5" />;
export const IconExitFullscreen = () => <Svg d="M11 6v5H6M22 11h-5V6M17 22v-5h5M6 17h5v5" />;
export const IconCamera = () => <Svg d="M5 10h4l2-3h6l2 3h4v11H5zM14 19a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7" />;
export const IconTable = () => <Svg d="M5 7h18v14H5zM5 12h18M5 16.5h18M11 7v14" />;
export const IconCalendar = () => <Svg d="M6 8h16v14H6zM6 12h16M10 6v4M18 6v4" />;
export const IconHelp = () => <Svg d="M14 23a9 9 0 1 0 0-18 9 9 0 0 0 0 18M11.5 11.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .8-1 1.5v.7M14 19v.2" />;
export const IconCaret = () => <svg {...base} width={12} height={12} viewBox="0 0 12 12"><path d="m3 4.5 3 3 3-3" /></svg>;

export const IconCandles = () => <Svg d="M9 5v4M9 19v4M7 9h4v10H7zM19 7v3M19 17v4M17 10h4v7h-4z" />;
export const IconHollow = () => <Svg d="M9 5v4M9 19v4M7 9h4v10H7zM19 7v3M19 17v4M17 10h4v7h-4z" strokeDasharray="0" />;
export const IconHeikin = () => <Svg d="M9 5v18M7 8h4v11H7zM19 5v18M17 11h4v8h-4z" />;
export const IconBars = () => <Svg d="M9 5v18M6 9h3M9 19h3M19 5v18M16 16h3M19 8h3" />;
export const IconLine = () => <Svg d="m5 19 6-6 4 4 8-9" />;
export const IconStep = () => <Svg d="M5 19h5v-6h5v4h4V9h4" />;
export const IconArea = () => <Svg d="m5 19 6-6 4 4 8-9v15H5z" />;
export const IconBaseline = () => <Svg d="M4 15h20M5 19l5-7 4 5 4-9 5 4" />;
export const IconColumns = () => <Svg d="M6 22V14M11 22V10M16 22V16M21 22V7" strokeWidth={3} />;
export const IconHighLow = () => <Svg d="M7 7v14M12 10v9M17 6v12M22 9v10" strokeWidth={2} />;
export const IconReplay = () => <Svg d="M7 7v14M21 7l-10 7 10 7z" />;
