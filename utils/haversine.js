const toRad = (v) => (v * Math.PI) / 180;
const R = 6371000;
exports.haversineMeters = ({ lat: lat1, lng: lng1 }, { lat: lat2, lng: lng2 }) => {
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const la1 = toRad(lat1);
  const la2 = toRad(lat2);
  const s = Math.sin(dLat/2)**2 + Math.cos(la1)*Math.cos(la2)*Math.sin(dLng/2)**2;
  return 2 * R * Math.asin(Math.sqrt(s));
};
