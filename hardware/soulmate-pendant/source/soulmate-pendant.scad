// Soulmate pendant prototype for Waveshare ESP32-S3-LCD-1.28.
// Units: millimeters. Print the body rear-side down and faceplates flat-side down.

part = is_undef(part) ? "assembly-cute" : part;
$fn = 64;

body_width = 46.8;
body_height = 48.8;
body_depth = 15.2;
faceplate_depth = 2.0;
display_opening = 33.2;
screw_points = [[0, 20], [-18, -12.5], [18, -12.5]];

module rounded_rect_2d(width, height, radius) {
  hull() {
    for (x = [-width / 2 + radius, width / 2 - radius])
      for (y = [-height / 2 + radius, height / 2 - radius])
        translate([x, y]) circle(r = radius);
  }
}

module body_profile() {
  union() {
    translate([0, -0.2]) scale([1, 24.4 / 23.4]) circle(r = 23.4);
    hull() {
      translate([0, 20.2]) circle(r = 4.7);
      translate([0, 29.3]) circle(r = 4.7);
    }
  }
}

module board_cavity_profile() {
  union() {
    translate([0, 0.2]) circle(r = 18.7);
    polygon([[-8.2, -17], [8.2, -17], [10.5, -21.7], [-10.5, -21.7]]);
  }
}

speaker_vents = [
  [8.5, 6.5], [12, 6.5], [15.5, 6.5],
  [10.25, 9.5], [13.75, 9.5],
  [8.5, 12.5], [12, 12.5], [15.5, 12.5]
];

module shell_profile() {
  difference() {
    body_profile();
    translate([0, 29.3]) circle(r = 2.4);
    translate([-14.2, -7.5]) circle(r = 0.9, $fn = 28);
    for (x = [-13.5, 13.5]) translate([x, 14.2]) circle(r = 1.05, $fn = 28);
    for (point = speaker_vents) translate(point) circle(r = 0.82, $fn = 28);
  }
}

module screw_pilots() {
  for (point = screw_points)
    translate([point[0], point[1], 10.2]) cylinder(h = 6.2, r = 0.82, $fn = 32);
}

module pendant_body() {
  difference() {
    linear_extrude(height = body_depth) shell_profile();
    translate([0, 0, 7.3]) linear_extrude(height = 9) board_cavity_profile();
    translate([-15.75, -12.2, 1.8]) cube([31.5, 28, 5.8]);
    translate([-6.25, -28.6, 6.4]) cube([12.5, 8, 8.4]);
    screw_pilots();
  }
}

module heart_2d() {
  union() {
    translate([-1.65, 0]) circle(r = 2.15);
    translate([1.65, 0]) circle(r = 2.15);
    polygon([[-3.75, 0], [3.75, 0], [0, -4.4]]);
  }
}

module diamond_2d() {
  polygon([[0, 4], [3.2, 0], [0, -4], [-3.2, 0]]);
}

module crescent_2d() {
  difference() {
    circle(r = 3.8);
    translate([1.7, 1.1]) circle(r = 3.55);
  }
}

module cute_silhouette() {
  for (lobe = [
    [-22.8, 5, 5.4, 1.08, 1.22], [-24.4, 10, 3.8, 1, 1.25],
    [22.8, 5, 5.4, 1.08, 1.22], [24.4, 10, 3.8, 1, 1.25]
  ])
    translate([lobe[0], lobe[1]]) scale([lobe[3], lobe[4]]) circle(r = lobe[2], $fn = 56);
}

module cool_silhouette() {
  polygon([[-22.8, 18], [-15.2, 31.5], [-8.8, 21.2]]);
  polygon([[22.8, 18], [15.2, 31.5], [8.8, 21.2]]);
}

module feather(x, y, angle, width, height) {
  translate([x, y]) rotate(angle) scale([width, height]) circle(r = 1);
}

module beautiful_silhouette() {
  feather(-22.2, -2, 29.8, 4.9, 10.5);
  feather(-24.2, -10.5, 44.7, 3.5, 8.2);
  feather(22.2, -2, -29.8, 4.9, 10.5);
  feather(24.2, -10.5, -44.7, 3.5, 8.2);
}

module face_profile(style) {
  union() {
    translate([0, -0.2]) scale([1, 24.4 / 23.4]) circle(r = 23.4);
    if (style == "cute") cute_silhouette();
    if (style == "cool") cool_silhouette();
    if (style == "beautiful") beautiful_silhouette();
  }
}

module face_relief(style) {
  translate([0, -19, 1.85]) linear_extrude(height = 0.95) {
    if (style == "cute") translate([0, -0.5]) heart_2d();
    if (style == "cool") diamond_2d();
    if (style == "beautiful") crescent_2d();
  }
}

module faceplate(style) {
  difference() {
    union() {
      linear_extrude(height = faceplate_depth) face_profile(style);
      face_relief(style);
    }
    translate([0, 0.4, -0.4]) cylinder(h = 3.4, r = display_opening / 2, $fn = 96);
    translate([0, 0.4, 1.2]) cylinder(h = 1.8, r = display_opening / 2 + 0.65, $fn = 96);
    for (point = screw_points)
      translate([point[0], point[1], -0.4]) cylinder(h = 3.6, r = 1.15, $fn = 32);
  }
}

module screen_placeholder() {
  color([0.04, 0.055, 0.075]) translate([0, 0.4, body_depth - 0.05]) cylinder(h = 0.16, r = 16.2);
}

module colored_face(style, z_offset) {
  if (style == "cute") color([0.95, 0.58, 0.54]) translate([0, 0, z_offset]) faceplate(style);
  if (style == "cool") color([0.18, 0.28, 0.48]) translate([0, 0, z_offset]) faceplate(style);
  if (style == "beautiful") color([0.76, 0.58, 0.78]) translate([0, 0, z_offset]) faceplate(style);
}

module reference_assembly(style, exploded = false) {
  color([0.83, 0.85, 0.86]) pendant_body();
  screen_placeholder();
  colored_face(style, exploded ? body_depth + 8 : body_depth - 0.08);
}

module print_plate() {
  translate([-58, 0, 0]) pendant_body();
  translate([5, 37, 0]) faceplate("cute");
  translate([5, -37, 0]) faceplate("cool");
  translate([65, 0, 0]) faceplate("beautiful");
}

if (part == "body") pendant_body();
else if (part == "face-cute") faceplate("cute");
else if (part == "face-cool") faceplate("cool");
else if (part == "face-beautiful") faceplate("beautiful");
else if (part == "assembly-cute") reference_assembly("cute");
else if (part == "assembly-cool") reference_assembly("cool");
else if (part == "assembly-beautiful") reference_assembly("beautiful");
else if (part == "exploded-cute") reference_assembly("cute", true);
else if (part == "shell-open") pendant_body();
else if (part == "print-plate") print_plate();
else pendant_body();
