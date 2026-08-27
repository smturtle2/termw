const std = @import("std");

pub fn build(b: *std.Build) void {
    const optimize = b.standardOptimizeOption(.{});

    const wasm = b.addExecutable(.{
        .name = "wterm",
        .root_module = b.createModule(.{
            .root_source_file = b.path("src/wasm_api.zig"),
            .target = b.resolveTargetQuery(.{
                .cpu_arch = .wasm32,
                .os_tag = .freestanding,
            }),
            .optimize = optimize,
        }),
    });

    wasm.entry = .disabled;
    wasm.rdynamic = true;

    b.installArtifact(wasm);

    const tests = b.addTest(.{
        .root_module = b.createModule(.{
            .root_source_file = b.path("src/terminal.zig"),
            .target = b.standardTargetOptions(.{}),
        }),
    });

    const run_tests = b.addRunArtifact(tests);
    const test_step = b.step("test", "Run unit tests");
    test_step.dependOn(&run_tests.step);
}
