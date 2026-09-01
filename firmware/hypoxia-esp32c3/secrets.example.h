/*
 * Copy this file to secrets.h (same folder) and paste the chamber's key in.
 *
 * secrets.h is gitignored. Do not put the key back in the .ino: this repo is
 * PUBLIC, and a key committed there is readable by anyone, forever, even after
 * it is deleted in a later commit.
 *
 * The key comes from TNT Operations:
 *   Incubation -> Hypoxia -> the chamber -> Issue new key
 * It is shown once. Each chamber needs its own.
 */
#pragma once

static const char* DEVICE_KEY = "PASTE_THE_KEY_HERE";
