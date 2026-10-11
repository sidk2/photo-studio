export const vertex = `#version 300 es
in vec2 position;
out vec2 uv;
void main() { uv = position * .5 + .5; gl_Position = vec4(position, 0., 1.); }
`
export const fragment = `#version 300 es
precision highp float;
in vec2 uv;
out vec4 outputColor;
uniform sampler2D image;
uniform sampler2D mask;
uniform bool useMask;
uniform bool copyOnly;
uniform float opacity;
uniform vec2 texel;
uniform vec2 origin;
uniform vec2 fullSize;
uniform vec2 tileSize;
uniform float pixelScale;
uniform float exposure, contrast, highlights, shadows, whites, blacks;
uniform float temperature, tint, saturation, vibrance, hue, value;
uniform float sharpness, radius, vignette;
uniform vec3 mixer[8];
const float centers[8] = float[8](0., 30., 60., 120., 180., 240., 270., 300.);
vec3 toLinear(vec3 c) { return mix(c / 12.92, pow(max((c + .055) / 1.055, 0.), vec3(2.4)), step(vec3(.04045), c)); }
vec3 toSRGB(vec3 c) { return mix(c * 12.92, 1.055 * pow(max(c, 0.), vec3(1. / 2.4)) - .055, step(vec3(.0031308), c)); }
vec3 rgb2hsv(vec3 c) {
  vec4 K = vec4(0., -1./3., 2./3., -1.);
  vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));
  vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));
  float d = q.x - min(q.w, q.y), e = 1.e-10;
  return vec3(abs(q.z + (q.w-q.y)/(6.*d+e)), d/(q.x+e), q.x);
}
vec3 hsv2rgb(vec3 c) {
  vec3 p = abs(fract(c.xxx + vec3(0., 2./3., 1./3.))*6.-3.);
  return c.z * mix(vec3(1.), clamp(p-1., 0., 1.), c.y);
}
void main() {
  vec4 original = texture(image, uv);
  if (copyOnly) { outputColor = vec4(clamp(original.rgb, 0., 1.), original.a); return; }
  vec3 c = original.rgb;
  if (sharpness > 0.) {
    vec2 d = texel * radius * pixelScale;
    vec3 blur = c * .25;
    blur += (texture(image, uv+vec2(d.x,0)).rgb + texture(image, uv-vec2(d.x,0)).rgb + texture(image, uv+vec2(0,d.y)).rgb + texture(image, uv-vec2(0,d.y)).rgb) * .125;
    blur += (texture(image, uv+d).rgb + texture(image, uv-d).rgb + texture(image, uv+vec2(d.x,-d.y)).rgb + texture(image, uv+vec2(-d.x,d.y)).rgb) * .0625;
    c += (c-blur)*sharpness/35.;
  }
  c = toLinear(max(c, 0.));
  c *= exp2(exposure);
  c *= vec3(1.+temperature*.0025+tint*.001, 1.-tint*.0015, 1.-temperature*.0025+tint*.001);
  c = toSRGB(c);
  float l = dot(c, vec3(.2126, .7152, .0722));
  float dark = 1.-smoothstep(.05, .65, l), light = smoothstep(.3, 1., l);
  c += shadows/100.*dark*.3 + highlights/100.*light*.3;
  c += whites/100.*smoothstep(.55, 1., l)*.22 + blacks/100.*(1.-smoothstep(0., .35, l))*.2;
  c = (c-.5)*(1.+contrast/100.)+.5;
  vec3 hsv = rgb2hsv(max(c, 0.));
  float originalHue = hsv.x*360.;
  vec3 shift = vec3(0.);
  for (int i=0; i<8; i++) {
    float distance = abs(originalHue-centers[i]); distance = min(distance, 360.-distance);
    float weight = 1.-smoothstep(0., 45., distance);
    shift += mixer[i]*weight;
  }
  hsv.x = fract(hsv.x + hue/360. + shift.x/600.);
  hsv.y = clamp(hsv.y*(1.+saturation/100.+shift.y/100.) + vibrance/100.*(1.-hsv.y)*hsv.y, 0., 1.);
  hsv.z *= 1.+value/100.;
  c = hsv2rgb(hsv);
  c += shift.z/100.*.35 * smoothstep(0., .15, hsv.y);
  vec2 position = (origin + vec2(uv.x, 1.-uv.y)*tileSize)/fullSize;
  float edge = smoothstep(.2, .75, length(position-.5));
  c *= 1.-vignette/100.*edge*.85;
  float amount = useMask ? texture(mask, uv).a * opacity : 1.;
  outputColor = vec4(mix(original.rgb, c, amount), original.a);
}
`
