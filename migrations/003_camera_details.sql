-- Camera settings read from the uploaded file's EXIF (members can correct or fill them in),
-- and whether the member chose to show them in the gallery.
ALTER TABLE photos ADD COLUMN aperture REAL;        -- f-number, e.g. 2.8
ALTER TABLE photos ADD COLUMN exposure_time REAL;   -- seconds, e.g. 0.004 for 1/250
ALTER TABLE photos ADD COLUMN iso INTEGER;
ALTER TABLE photos ADD COLUMN show_exif INTEGER NOT NULL DEFAULT 0;
