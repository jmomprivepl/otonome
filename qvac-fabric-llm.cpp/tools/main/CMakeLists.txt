set(TARGET llama-cli)
add_executable(${TARGET} main.cpp persona_plugin.cpp qvac_memory_patcher.cpp)
target_link_libraries(${TARGET} PRIVATE common llama ${CMAKE_THREAD_LIBS_INIT})
target_compile_features(${TARGET} PRIVATE cxx_std_17)

add_executable(persona-memcpy-smoke persona_memcpy_smoke.cpp)
target_compile_features(persona-memcpy-smoke PRIVATE cxx_std_17)

if(LLAMA_TOOLS_INSTALL)
    install(TARGETS ${TARGET} RUNTIME)
endif()
