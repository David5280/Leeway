-- Whether a bill's amount moves from cycle to cycle (power, water), as the
-- recurring finder saw it when the bill was tracked in one tap. Such a bill
-- gets no alert when its amount changes, since it changes most cycles.
ALTER TABLE bills ADD COLUMN amount_varies boolean NOT NULL DEFAULT false;
