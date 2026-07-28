// NEXORA CORE NC-01 printable enclosure for Waveshare ESP32-S3-LCD-1.28.
// Units: millimeters. The front frame exports face-down for support-free printing.

part = is_undef(part) ? "assembly" : part;
$fn = 72;

body_depth = 14.8;
frame_depth = 2.2;
post_depth = 4.8;
display_opening = 33.2;
lanyard_hole = 4.8;
light_outer_radius = 20.7;
light_inner_radius = 17.25;
screw_points = [[0, 22.2], [-18.2, -14.2], [18.2, -14.2]];

core_outline = [
  [-4.8, 33.5], [4.8, 33.5], [8.6, 28.8], [19.8, 20.8],
  [25.0, 7.2], [23.2, -13.5], [16.0, -26.0], [6.2, -33.5],
  [-6.2, -33.5], [-16.0, -26.0], [-23.2, -13.5], [-25.0, 7.2],
  [-19.8, 20.8], [-8.6, 28.8]
];

module core_profile() {
  polygon(core_outline);
}

module regular_polygon_2d(radius, sides = 8, rotation = 22.5) {
  polygon([for (index = [0 : sides - 1])
    [radius * cos(rotation + index * 360 / sides), radius * sin(rotation + index * 360 / sides)]]);
}

module line_2d(start, finish, width) {
  hull() {
    translate(start) circle(r = width / 2, $fn = 20);
    translate(finish) circle(r = width / 2, $fn = 20);
  }
}

module octagonal_ring_2d(outer_radius, inner_radius) {
  difference() {
    regular_polygon_2d(outer_radius);
    circle(r = inner_radius, $fn = 112);
  }
}

module faceted_body_solid() {
  hull() {
    linear_extrude(height = 0.02) offset(delta = -1.15) core_profile();
    translate([0, 0, 1.15]) linear_extrude(height = 0.02) core_profile();
    translate([0, 0, body_depth - 0.95]) linear_extrude(height = 0.02) core_profile();
    translate([0, 0, body_depth - 0.02]) linear_extrude(height = 0.02) offset(delta = -0.85) core_profile();
  }
}

module faceted_frame_plate() {
  hull() {
    linear_extrude(height = 0.02) core_profile();
    translate([0, 0, frame_depth - 0.72]) linear_extrude(height = 0.02) core_profile();
    translate([0, 0, frame_depth - 0.02]) linear_extrude(height = 0.02) offset(delta = -0.9) core_profile();
  }
}

module board_cavity_profile() {
  union() {
    translate([0, -0.3]) circle(r = 18.72, $fn = 96);
    polygon([[-9.2, -15.5], [9.2, -15.5], [7.0, -25.4], [-7.0, -25.4]]);
  }
}

module trapezoid_usb_profile() {
  polygon([[-7.2, -34.3], [7.2, -34.3], [5.4, -22.6], [-5.4, -22.6]]);
}

module rear_vent_profile() {
  for (offset = [-3.6, 0, 3.6])
    translate([0, offset]) line_2d([8.0, 8.2], [15.2, 11.4], 1.05);
}

module rear_detail_profile() {
  line_2d([-18.0, 17.0], [-11.5, 22.5], 0.7);
  line_2d([-19.6, 12.8], [-13.0, 18.3], 0.7);
  line_2d([11.0, -23.0], [17.5, -16.5], 0.7);
}

module peripheral_relief_profile() {
  difference() {
    offset(delta = -2.15) core_profile();
    offset(delta = 2.15) board_cavity_profile();
    for (point = screw_points) translate(point) circle(r = 4.1, $fn = 40);
    translate([0, 28.9]) circle(r = 5.2, $fn = 48);
  }
}

module body_post_pockets() {
  for (point = screw_points)
    translate([point[0], point[1], body_depth - post_depth - 0.15])
      cylinder(h = post_depth + 0.5, r = 3.18, $fn = 44);
}

module rear_fastener_holes() {
  for (point = screw_points) {
    translate([point[0], point[1], -0.25]) cylinder(h = body_depth + 0.5, r = 1.12, $fn = 36);
    translate([point[0], point[1], -0.25]) cylinder(h = 2.25, r = 2.35, $fn = 44);
  }
}

module nexora_body() {
  difference() {
    faceted_body_solid();
    translate([0, 0, 6.35]) linear_extrude(height = body_depth) board_cavity_profile();
    translate([-15.75, -13.2, 1.8]) cube([31.5, 28.0, 5.85]);
    translate([0, 0, 1.8]) linear_extrude(height = body_depth) peripheral_relief_profile();
    translate([0, 0, 6.1]) linear_extrude(height = 9.1) trapezoid_usb_profile();
    translate([0, 28.9, -0.3]) cylinder(h = body_depth + 0.6, r = lanyard_hole / 2, $fn = 56);
    translate([-14.8, 7.5, -0.2]) cylinder(h = 2.5, r = 0.9, $fn = 32);
    translate([0, 0, -0.2]) linear_extrude(height = 2.5) rear_vent_profile();
    translate([0, 0, -0.1]) linear_extrude(height = 0.5) rear_detail_profile();
    body_post_pockets();
    rear_fastener_holes();
  }
}

module frame_technical_grooves() {
  line_2d([-21.7, 8.2], [-16.0, 20.0], 0.72);
  line_2d([21.7, 8.2], [16.0, 20.0], 0.72);
  line_2d([-19.6, -17.5], [-13.6, -25.0], 0.72);
  line_2d([19.6, -17.5], [13.6, -25.0], 0.72);
  line_2d([-12.5, 25.1], [-7.5, 29.0], 0.62);
  line_2d([12.5, 25.1], [7.5, 29.0], 0.62);
}

module frame_posts() {
  for (point = screw_points)
    translate([point[0], point[1], -post_depth])
      cylinder(h = post_depth + 0.08, r = 3.0, $fn = 44);
}

module front_frame_model() {
  difference() {
    union() {
      faceted_frame_plate();
      frame_posts();
    }
    translate([0, 0, -post_depth - 0.3])
      cylinder(h = post_depth + frame_depth + 0.7, r = display_opening / 2, $fn = 112);
    translate([0, 28.9, -post_depth - 0.3])
      cylinder(h = post_depth + frame_depth + 0.7, r = lanyard_hole / 2, $fn = 56);
    translate([0, 0, frame_depth - 0.88])
      linear_extrude(height = 1.1) octagonal_ring_2d(light_outer_radius + 0.18, light_inner_radius - 0.12);
    translate([0, 0, frame_depth - 0.48])
      linear_extrude(height = 0.7) frame_technical_grooves();
    for (point = screw_points)
      translate([point[0], point[1], -post_depth - 0.3])
        cylinder(h = post_depth + 1.15, r = 0.82, $fn = 32);
  }
}

module segmented_light_ring_2d() {
  difference() {
    octagonal_ring_2d(light_outer_radius, light_inner_radius);
    for (angle = [0, 90, 180, 270])
      rotate(angle) translate([-0.7, light_inner_radius - 0.4]) square([1.4, 5.3]);
  }
}

module light_guide() {
  union() {
    linear_extrude(height = 0.34)
      octagonal_ring_2d(light_outer_radius, light_inner_radius);
    translate([0, 0, 0.34]) linear_extrude(height = 0.46)
      segmented_light_ring_2d();
  }
}

module front_frame_print() {
  translate([0, 0, frame_depth]) rotate([180, 0, 0]) front_frame_model();
}

module screen_placeholder() {
  color([0.025, 0.035, 0.05])
    translate([0, 0, body_depth + frame_depth + 0.03]) cylinder(h = 0.18, r = 16.2, $fn = 112);
}

module cyan_status_segment() {
  color([0.08, 0.88, 1.0])
    translate([0, 0, body_depth + frame_depth - 0.82])
      intersection() {
        light_guide();
        translate([9, -22, -0.1]) cube([16, 20, 1.2]);
      }
}

module reference_assembly(exploded = false) {
  color([0.11, 0.135, 0.16, 0.82]) nexora_body();
  color([0.47, 0.50, 0.53])
    translate([0, 0, body_depth + (exploded ? 8 : 0)]) front_frame_model();
  color([1.0, 0.38, 0.26])
    translate([0, 0, body_depth + frame_depth - 0.84 + (exploded ? 16 : 0)]) light_guide();
  if (!exploded) cyan_status_segment();
  screen_placeholder();
}

module print_plate() {
  translate([-62, 0, 0]) nexora_body();
  translate([2, 0, 0]) front_frame_print();
  translate([52, 0, 0]) light_guide();
}

if (part == "body") nexora_body();
else if (part == "front-frame") front_frame_print();
else if (part == "light-guide") light_guide();
else if (part == "assembly") reference_assembly();
else if (part == "exploded") reference_assembly(true);
else if (part == "shell-open") nexora_body();
else if (part == "print-plate") print_plate();
else nexora_body();
