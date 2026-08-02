#include "/Header/header.setting.h" // Path remapping
#include "header.h" // Includes

uint test(uint param) {
	return 42;
}
#ifdef INCLUDED_MACRO // Includes
#ifdef SETTINGS_MACRO // Defines
void main() {
	uint res = test(0);
}
#endif
#endif