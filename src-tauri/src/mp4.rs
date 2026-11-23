use std::fs;
use std::io::{Read, Seek, SeekFrom};
use std::path::Path;

pub fn needs_faststart(path: &Path) -> bool {
    let Ok(mut file) = fs::File::open(path) else {
        return false;
    };
    let Ok(file_size) = file.metadata().map(|metadata| metadata.len()) else {
        return false;
    };

    let mut offset = 0u64;
    let mut found_mdat = false;

    while offset + 8 <= file_size {
        if file.seek(SeekFrom::Start(offset)).is_err() {
            return false;
        }

        let mut header = [0u8; 8];
        if file.read_exact(&mut header).is_err() {
            return false;
        }

        let size_32 = u32::from_be_bytes([header[0], header[1], header[2], header[3]]) as u64;
        let box_type = &header[4..8];
        let mut box_size = size_32;

        if size_32 == 1 {
            let mut extended_size = [0u8; 8];
            if file.read_exact(&mut extended_size).is_err() {
                return false;
            }
            box_size = u64::from_be_bytes(extended_size);
        } else if size_32 == 0 {
            box_size = file_size - offset;
        }

        if box_size < 8 || offset + box_size > file_size {
            return false;
        }

        if box_type == b"moov" {
            return found_mdat;
        }
        if box_type == b"mdat" {
            found_mdat = true;
        }

        offset += box_size;
    }

    false
}
