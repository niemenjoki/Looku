-- Shop reports read orders by day.
CREATE INDEX orders_ext_site_day ON orders_ext (site_id, day);
