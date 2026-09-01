app_path = defines["app"]
background_path = defines["background"]
volume_icon_path = defines["icon"]

# Finder stores a disk image's presentation in .DS_Store. dmgbuild writes that
# file directly, so packaging does not depend on Finder launching or eventually
# flushing asynchronous window state.
files = [(app_path, "Umbrel.app")]
symlinks = {"Applications": "/Applications"}
icon = volume_icon_path
background = background_path

format = "UDZO"
filesystem = "HFS+"
window_rect = ((120, 120), (660, 400))
default_view = "icon-view"

show_toolbar = False
show_status_bar = False
show_pathbar = True
show_sidebar = False
show_tab_view = False

icon_size = 128
text_size = 13
icon_locations = {
    "Umbrel.app": (190, 150),
    "Applications": (470, 150),
}
