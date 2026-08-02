#include "/Header/header.setting.h" // Path remapping
#include "header.h" // Includes

struct VSInput {
    [[vk::location(0)]] float3 Position : POSITION0;
    [[vk::location(1)]] float3 Normal : NORMAL0;
    [[vk::location(2)]] float2 TexCoord : TEXCOORD0;
};

float16_t test(uint param) {
	float16_t testValue = 42.0;
	return testValue;
}
#ifdef INCLUDED_MACRO // Includes
#ifdef SETTINGS_MACRO // Defines
void main() {
	float16_t res = test(0);
}
#endif
#endif