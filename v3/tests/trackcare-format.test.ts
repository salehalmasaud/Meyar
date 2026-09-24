import test from 'node:test';
import assert from 'node:assert/strict';
import {buildTrackcareHtml} from '../src/trackcare-format.ts';

test('TrackCare rich formatter matches the approved note typography',()=>{
  const note=`(Dietitian) - inpatient

Pt: 36-year-old female
Dx: DLBCL on R-CHOP chemotherapy.

Nutrition Assessment

- Diet history reviewed.
- Poor appetite and reduced oral intake.

Anthropometrics

Wt: 59.4 kg
Ht: 156 cm
BMI: 24.4 kg/m2

Laboratory:

Reviewed.

- K: 3.2 mmol/L (Low)

Nutrition Requirements

- Energy: 1500–1800 kcal/day.
- Protein: 70–90 g/day.

Plan:

- Provide freshly prepared, fully cooked meals.
- Follow up by clinical dietitian.`;

  const html=buildTrackcareHtml(note);
  assert.match(html,/Times New Roman/);
  assert.match(html,/Cambria/);
  assert.match(html,/#006666/);
  assert.match(html,/#ECF0F1/);
  assert.match(html,/13\.5pt/);
  assert.match(html,/12pt/);
  assert.match(html,/10pt/);
  assert.match(html,/text-decoration:underline/);
  assert.match(html,/•/);
  assert.match(html,/Pt: 36-year-old female/);
  assert.match(html,/Nutrition Assessment/);
});

test('TrackCare rich formatter escapes note text before building HTML',()=>{
  const html=buildTrackcareHtml('Plan:\n\n- A < B & C');
  assert.ok(html.includes('A &lt; B &amp; C'));
  assert.ok(!html.includes('A < B & C'));
});
