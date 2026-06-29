#define CUSTOM_MACRO 1
#include "macro.hlsl"

#if VARIANT_DEFINE
void mainOk() {
    float variant = 2.0;
}
#else 
void mainError() {
    float error
}
#endif