
import sys

file_path = r'c:\Users\motawa\Documents\MediaVault - 7.1\renderer.js'

with open(file_path, 'r', encoding='utf-8') as f:
    lines = f.readlines()

# We want to remove the legacy SubDL/OS search and load logic.
# Based on previous view_file, the block starts around 2070 and ends around 2347.
# I'll search for the specific markers to be precise.

start_marker = '    window.openSubtitleSearch = async (manualQuery) => {'
end_marker = '  function updateVolumeIcon()' # The line right after the legacy block

# Use searching instead of hardcoded line numbers to be safe
start_idx = -1
end_idx = -1

for i, line in enumerate(lines):
    if start_marker in line:
        start_idx = i
    if end_marker in line:
        end_idx = i
        break # Stop here

if start_idx != -1 and end_idx != -1:
    print(f"Removing lines {start_idx} to {end_idx-1}")
    new_lines = lines[:start_idx] + ["\n  // Legacy Cloud Subtitles Removed\n\n"] + lines[end_idx:]
    with open(file_path, 'w', encoding='utf-8') as f:
        f.writelines(new_lines)
    print("Cleanup successful.")
else:
    print(f"Markers not found. Start: {start_idx}, End: {end_idx}")
