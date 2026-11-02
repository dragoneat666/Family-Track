// Draws the tracking boxes over the camera picture: the mouth box (green
// = brushing, yellow = face seen but not brushing, red = no face) and a thin
// white box across the eyes.
export function drawOverlay(canvas, st, show) {
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  if (!show || !st.region) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    return;
  }
  if (canvas.width !== st.videoWidth) {
    canvas.width = st.videoWidth;
    canvas.height = st.videoHeight;
  }
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.lineWidth = 4;
  ctx.strokeStyle = st.brushing ? '#3ddc84' : st.faceVisible ? '#ffcc00' : '#ff5555';
  ctx.strokeRect(st.region.x, st.region.y, st.region.w, st.region.h);
  if (st.eyeRegion) {
    ctx.lineWidth = 2;
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.8)';
    ctx.strokeRect(st.eyeRegion.x, st.eyeRegion.y, st.eyeRegion.w, st.eyeRegion.h);
  }
}
