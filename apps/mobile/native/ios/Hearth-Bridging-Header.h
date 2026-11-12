// Objective-C bridging header exposing the Hearth Suite core C-ABI (crates/ffi) to
// Swift. The build copies this into the generated iOS project and sets it as the
// target's SWIFT_OBJC_BRIDGING_HEADER (see ci/mobile/apply-native.sh).

#ifndef HEARTH_BRIDGING_HEADER_H
#define HEARTH_BRIDGING_HEADER_H

#include <stddef.h>
#include <stdint.h>

// Opaque handle to a Hearth Suite core instance (a boxed Rust HearthCore).
typedef struct HearthCore HearthCore;

// Open the on-device vault at `db_path` using a 32-byte identity `seed`.
// Returns NULL on error. Free with hearth_core_free.
HearthCore *hearth_core_open(const char *db_path, const uint8_t *seed, size_t seed_len);

// Dispatch a JSON `{ method, params }` request, returning a newly-allocated
// `{ ok } / { error }` JSON string. Free it with hearth_string_free.
char *hearth_call(HearthCore *core, const char *request_json);

// Free a string returned by hearth_call.
void hearth_string_free(char *s);

// Free a core returned by hearth_core_open.
void hearth_core_free(HearthCore *core);

#endif /* HEARTH_BRIDGING_HEADER_H */
