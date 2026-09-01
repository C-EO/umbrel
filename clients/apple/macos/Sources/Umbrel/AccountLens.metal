#include <metal_stdlib>
#include <SwiftUI/SwiftUI.h>

using namespace metal;

// Matches the iOS account lens: the center stays undistorted while the convex
// bevel bends the live avatar strip and adds a slight chromatic rim.
[[ stitchable ]] half4 accountLens(
	float2 position,
	SwiftUI::Layer layer,
	float2 center,
	float radius,
	float bevel,
	float scale,
	float chroma
) {
	float2 delta = position - center;
	float distanceFromCenter = length(delta);
	float signedDistance = distanceFromCenter - radius;

	if (signedDistance >= 0.0 || -signedDistance > bevel || distanceFromCenter < 0.0001) {
		return layer.sample(position);
	}

	float u = clamp(-signedDistance / bevel, 0.0, 1.0);
	float inverseU = 1.0 - u;
	float slopeDenominator = pow(max(1.0 - pow(inverseU, 4.0), 0.0001), 0.75);
	float slope = pow(inverseU, 3.0) / slopeDenominator;

	constexpr float refractiveIndex = 1.5;
	constexpr float maximumBend = 0.7453559925;
	float incidentAngle = atan(slope);
	float bend = sin(incidentAngle - asin(sin(incidentAngle) / refractiveIndex)) / maximumBend;
	float2 displacement = (delta / distanceFromCenter) * bend * scale;

	half4 redSample = layer.sample(position + displacement * (1.0 + chroma));
	half4 greenSample = layer.sample(position + displacement);
	half4 blueSample = layer.sample(position + displacement * (1.0 - chroma));
	half alpha = max(redSample.a, max(greenSample.a, blueSample.a));

	return half4(redSample.r, greenSample.g, blueSample.b, alpha);
}
