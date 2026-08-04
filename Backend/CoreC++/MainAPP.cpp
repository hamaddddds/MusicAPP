#include <iostream>

extern "C" {

    const char* GetAppVersion() {
        return "1.0.0-core";
    }

    void InitializeCore() {
        std::cout << "C++ Core Initialized!" << std::endl;
    }

}
