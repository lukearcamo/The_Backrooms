export const vs = "varying vec2 UV; void main() { UV = uv; gl_Position = vec4(position, 1.0); }";
export const fs = `
#define PI 3.14159265358979323846
#define MAX_DIST 1000.0
#define FOV 30.0 * PI / 180.0

uniform float time;
uniform float aspect;
varying vec2 UV;

float rand(float q) { q = fract(q * 0.1031); q *= q + 33.33; return fract((q + q) * q); }

float sdfPlane(vec3 p, vec3 n, float c) { return dot(p, n) + c; }
float sdfBox(vec3 p, vec3 dim) {
    vec3 q = abs(p) - dim;
    return length(max(q, 0.0)) + min(max(q.x, max(q.y, q.z)), 0.0);
}
float sdfBox2D(vec2 p, vec2 b) {
    vec2 q = abs(p) - b;
    return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0);
}
float infinite1D(float p, float cellSize) {
    float halfCellSize = 0.5 * cellSize;
    return mod(p + halfCellSize, cellSize) - halfCellSize;
}
vec4 opUnion(vec4 a, vec4 b) { return a.w < b.w ? a : b; }

// Light flicker - changes the period & offset of infinite light repetition, so sometimes some spots are skipped & have no light
void lightFlash(out float period, out float offset) {
    period = step(0.9, rand(floor(time * 20.0))) * 4.0 + 4.0;
    offset = step(0.5, rand(floor(time))) * 4.0;
}
const float mX = 40.0;
vec3 wallpaper(vec2 p) {
    float stripes = step(0.7, sin(p.x * mX + PI / 2.0));
    float cell = step(0.0, sin(p.x * mX * 0.5)); 
    float waves = p.y * 10.0 + cell * PI + cos(p.x * mX) * 0.5;
    float arrows = step(0.95, sin(waves));
    float underArrows = step(0.99, sin(waves + PI * 0.25));
    return vec3(0.93, 0.95, 0.58) * mix(1.0, 0.8, max(1.0 - step(0.2, p.y), max(stripes, max(arrows, underArrows))));
}

const vec4 C = vec4(0.0, 1.0, -1.0, 0.01);
vec4 Scene(vec3 p) {
    vec4 M;
    M.w = MAX_DIST;

    vec3 wp = wallpaper(p.xy); 
    M = opUnion(M, vec4(0.95, 0.90, 0.58, dot(vec3(p.x, abs(p.y - 1.25), p.z), C.xzx) + 1.25));
    M = opUnion(M, vec4(wp, dot(p, C.xxy) + 5.0));

    M = opUnion(M, vec4(wallpaper(p.zy), sdfBox2D(p.xz - vec2(-4.0, 0.0), vec2(0.2, 3.0))));
    M = opUnion(M, vec4(wp, sdfBox2D(p.xz - vec2(-4.0, -1.0), vec2(3.0, 0.2))));
    M = opUnion(M, vec4(wp, sdfBox2D(vec2(abs(p.x), p.z) - vec2(4.0, 10.0), vec2(2.9, 0.2))));

    M.w -= smoothstep(0.15, 0.2, p.y) * -0.02;

    vec3 q = p - vec3(200.0 * max(0.99, sin(time)) - 201.0, 1.0 + sin(PI * time), -2.0);
    M = opUnion(M, vec4(C.xxx, length(q) - 0.2));
    M = opUnion(M, vec4(vec3(5.0), length(vec3(q.x, abs(q.y) - 0.1, q.z - 0.2)) - 0.02));

    float lPeriod, lOffset;
    lightFlash(lPeriod, lOffset);
    p.xy -= vec2(-1.0, 2.5);
    M = opUnion(M, vec4(vec3(0.5), sdfBox(vec3(p.xy, infinite1D(p.z, 4.0)), vec3(0.51, C.w, 0.51))));
    M = opUnion(M, vec4(vec3(5.0), sdfBox(vec3(p.xy, infinite1D(p.z + lOffset, lPeriod)), vec3(0.5, C.w, 0.5))));

    return M;
}

vec3 Normal(vec3 p) {
    return normalize(vec3(
        Scene(p + C.wxx).w,
        Scene(p + C.xwx).w,
        Scene(p + C.xxw).w
    ) - Scene(p).w);
}
float AO(vec3 p, vec3 normal, float tmax) { // Adapted from http://www.aduprat.com/portfolio/?page=articles/hemisphericalSDFAO
    float ao = 0.0;
    const float iterations = 2.0;
    const float invIterations = 0.5;
    float stepSize = tmax * invIterations;
    for (float i = 0.0; i < iterations; i++) {
        float l = stepSize;
        p += normal * stepSize;
        ao += (l - max(0.0, Scene(p).w)) / tmax;
    }
    return smoothstep(0.0, 0.8, 1.0 - ao * invIterations);
}

vec3 Raymarch(vec3 ro, vec3 rd) {
    float t = 0.0;
    vec3 p = ro;
    vec3 color;
    for (int i = 0; i < 100; i++) {
        vec4 scene = Scene(p);
        color = scene.rgb;
        if (scene.w < C.w) break;
        t += scene.w;
        p += rd * scene.w;
        if (t >= MAX_DIST) return C.xxx;
    }

    vec3 nml = Normal(p);
    float lPeriod, lOffset;
    lightFlash(lPeriod, lOffset);
    vec3 pInf = vec3(p.xy, infinite1D(p.z + lOffset, lPeriod));

    float lighting = dot(nml, normalize(vec3(-1.0, 2.0, 0.0) - pInf));
    float lightingFwd = dot(nml, normalize(vec3(-1.0, 2.0, lPeriod) - pInf));
    float lightingBwd = dot(nml, normalize(vec3(-1.0, 2.0, -lPeriod) - pInf));
    lighting = max(lighting, max(lightingFwd, lightingBwd)); // Lighting from neighboring cells
    lighting = (lighting + lightingFwd + lightingBwd) / 3.0; // Soften discontinuities
    color *= lighting + vec3(0.2, 0.17, 0.1);

    color *= AO(p, nml, 1.0);
    return color;
}
void main() {
    vec2 NDC = UV * 2.0 - 1.0;
    
    vec3 cPos = vec3(
        1.2 + 0.05 * cos(1.21 * cos(time) - 0.39 * time),
        1.7 + 0.05 * sin(1.27 * cos(time) - 0.35 * time),
        14.0 + 0.05 * cos(1.29 * cos(time) - 0.31 * time));

    vec3 cFwd = normalize(vec3(0.0) - cPos);
    vec3 cRgt = normalize(cross(cFwd, vec3(C.w * sin(time), 1.0, 0.0)));
    vec3 cUp = cross(cRgt, cFwd);

    vec3 rd = normalize(NDC.x * aspect * cRgt + NDC.y * cUp + cFwd / tan(FOV * 0.5));
    vec3 color = Raymarch(cPos, rd);

    color += vec3(
        rand(UV.x * 327.97 - UV.y * 211.43 + time),
        rand(UV.x * 67.99 * UV.y * 176.21 + time),
        rand(UV.x * 219.32 - UV.y * 8.0159 * time)
    ) * 0.3 - 0.15;
    color *= 1.0 - distance(NDC, vec2(0.0)) * 0.3;
    gl_FragColor = vec4(color, 1.0);
}`