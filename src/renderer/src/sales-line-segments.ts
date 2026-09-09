type PlotPoint = { x: number; y: number; partial: boolean };
const xy = (p: PlotPoint) => `${p.x.toFixed(2)},${p.y.toFixed(2)}`;

/** Incomplete marketplace days keep their real value but never a solid trend edge. */
export function salesLineSegments(points: readonly PlotPoint[]) {
  let complete = "", partial = "", drawing = false;
  for (let i = 0; i < points.length; i += 1) {
    const point = points[i], previous = points[i - 1];
    if (!point.partial) {
      complete += `${complete ? " " : ""}${drawing ? "L" : "M"}${xy(point)}`;
      drawing = true;
    } else drawing = false;
    if (previous && (previous.partial || point.partial)) partial += `${partial ? " " : ""}M${xy(previous)} L${xy(point)}`;
  }
  return { complete, partial };
}
