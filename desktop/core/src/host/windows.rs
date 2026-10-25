use std::{ffi::OsStr, os::windows::ffi::OsStrExt, path::Path};

/// Windows command-line quoting shared by detached launch and the HKCU Run entry.
pub(super) fn command(exe: &OsStr, directory: &Path) -> Vec<u16> {
    let quote = |value: &OsStr| {
        let mut out = vec![b'"' as u16];
        let mut slashes = 0;
        for unit in value.encode_wide() {
            if unit == b'\\' as u16 {
                slashes += 1;
                continue;
            }
            out.extend(std::iter::repeat_n(
                b'\\' as u16,
                if unit == b'"' as u16 {
                    slashes * 2 + 1
                } else {
                    slashes
                },
            ));
            out.push(unit);
            slashes = 0;
        }
        out.extend(std::iter::repeat_n(b'\\' as u16, slashes * 2));
        out.push(b'"' as u16);
        out
    };
    let mut line = quote(exe);
    line.extend(" --host-supervisor --data-dir ".encode_utf16());
    line.extend(quote(directory.as_os_str()));
    line.push(0);
    line
}
