# UX audit: before

136 checks (17 sections x 1440/1024/768/390px x light/dark). 103 with findings.

| Section | Width | Scheme | Axe serious/critical | Sideways scroll | Overflowing | Clipped | Internal codes | JS errors |
|---|---|---|---|---|---|---|---|---|
| overview | 1440 | light | 0 | no | 0 | 0 | - | 0 |
| analysis | 1440 | light | scrollable-region-focusable×2 | no | 0 | 0 | - | 0 |
| members | 1440 | light | aria-allowed-attr×3, color-contrast×1 | no | 0 | 0 | - | 0 |
| leave | 1440 | light | 0 | no | 0 | 0 | - | 0 |
| units | 1440 | light | 0 | no | 0 | 0 | DEPT_OF_CARDIAC_ANAESTHESIA, DEPT_OF_NEUROANAESTHESIA, UNIT_I, UNIT_II, UNIT_III, UNIT_IV | 0 |
| rota-setup | 1440 | light | select-name×8 | no | 0 | 0 | DEPT_OF_CARDIAC_ANAESTHESIA, DEPT_OF_NEUROANAESTHESIA, UNIT_I, UNIT_II, UNIT_III, UNIT_IV | 0 |
| rota-template | 1440 | light | aria-allowed-attr×4, aria-required-children×1 | yes | 3 | 0 | - | 0 |
| rota-review | 1440 | light | 0 | no | 0 | 0 | - | 0 |
| rota-publish | 1440 | light | 0 | no | 0 | 0 | - | 0 |
| user-guide | 1440 | light | 0 | no | 0 | 0 | - | 0 |
| rota-rules | 1440 | light | 0 | no | 0 | 0 | MAIN_1ST_24HR, MAIN_1ST_CO_24HR, MAIN_2ND_24HR, MAIN_3RD_24HR, MAIN_4TH_24HR, MAIN_CO3RD_24HR | 0 |
| call-clusters | 1440 | light | target-size×1 | no | 0 | 0 | - | 0 |
| mappings | 1440 | light | 0 | no | 0 | 0 | - | 0 |
| imports | 1440 | light | 0 | no | 0 | 0 | - | 0 |
| accounts | 1440 | light | 0 | no | 0 | 0 | - | 0 |
| diagnostics | 1440 | light | 0 | no | 0 | 0 | - | 0 |
| compute-settings | 1440 | light | 0 | no | 0 | 0 | - | 0 |
| overview | 1024 | light | 0 | yes | 2 | 0 | - | 0 |
| analysis | 1024 | light | 0 | yes | 8 | 0 | - | 0 |
| members | 1024 | light | aria-allowed-attr×3, color-contrast×1 | yes | 8 | 0 | - | 0 |
| leave | 1024 | light | scrollable-region-focusable×1 | yes | 8 | 0 | - | 0 |
| units | 1024 | light | scrollable-region-focusable×1 | yes | 8 | 0 | DEPT_OF_CARDIAC_ANAESTHESIA, DEPT_OF_NEUROANAESTHESIA, UNIT_I, UNIT_II, UNIT_III, UNIT_IV | 0 |
| rota-setup | 1024 | light | select-name×8 | yes | 3 | 0 | DEPT_OF_CARDIAC_ANAESTHESIA, DEPT_OF_NEUROANAESTHESIA, UNIT_I, UNIT_II, UNIT_III, UNIT_IV | 0 |
| rota-template | 1024 | light | aria-allowed-attr×4, aria-required-children×1 | yes | 8 | 0 | - | 0 |
| rota-review | 1024 | light | scrollable-region-focusable×7 | yes | 7 | 0 | - | 0 |
| rota-publish | 1024 | light | 0 | yes | 4 | 0 | - | 0 |
| user-guide | 1024 | light | 0 | yes | 2 | 0 | - | 0 |
| rota-rules | 1024 | light | 0 | no | 0 | 0 | MAIN_1ST_24HR, MAIN_1ST_CO_24HR, MAIN_2ND_24HR, MAIN_3RD_24HR, MAIN_4TH_24HR, MAIN_CO3RD_24HR | 0 |
| call-clusters | 1024 | light | target-size×1 | yes | 3 | 0 | - | 0 |
| mappings | 1024 | light | scrollable-region-focusable×1 | yes | 2 | 0 | - | 0 |
| imports | 1024 | light | 0 | yes | 3 | 0 | - | 0 |
| accounts | 1024 | light | 0 | yes | 2 | 0 | - | 0 |
| diagnostics | 1024 | light | 0 | no | 0 | 0 | - | 0 |
| compute-settings | 1024 | light | 0 | no | 0 | 0 | - | 0 |
| overview | 768 | light | 0 | no | 0 | 0 | - | 0 |
| analysis | 768 | light | 0 | yes | 8 | 0 | - | 0 |
| members | 768 | light | color-contrast×1 | no | 0 | 0 | - | 0 |
| leave | 768 | light | 0 | no | 0 | 0 | - | 0 |
| units | 768 | light | 0 | no | 0 | 0 | DEPT_OF_CARDIAC_ANAESTHESIA, DEPT_OF_NEUROANAESTHESIA, UNIT_I, UNIT_II, UNIT_III, UNIT_IV | 0 |
| rota-setup | 768 | light | select-name×8 | no | 0 | 0 | DEPT_OF_CARDIAC_ANAESTHESIA, DEPT_OF_NEUROANAESTHESIA, UNIT_I, UNIT_II, UNIT_III, UNIT_IV | 0 |
| rota-template | 768 | light | aria-allowed-attr×4, aria-required-children×1 | yes | 2 | 0 | - | 0 |
| rota-review | 768 | light | 0 | yes | 1 | 0 | - | 0 |
| rota-publish | 768 | light | 0 | no | 0 | 0 | - | 0 |
| user-guide | 768 | light | 0 | no | 0 | 0 | - | 0 |
| rota-rules | 768 | light | 0 | no | 0 | 0 | MAIN_1ST_24HR, MAIN_1ST_CO_24HR, MAIN_2ND_24HR, MAIN_3RD_24HR, MAIN_4TH_24HR, MAIN_CO3RD_24HR | 0 |
| call-clusters | 768 | light | target-size×1 | no | 0 | 0 | - | 0 |
| mappings | 768 | light | 0 | no | 0 | 0 | - | 0 |
| imports | 768 | light | 0 | no | 0 | 0 | - | 0 |
| accounts | 768 | light | 0 | no | 0 | 0 | - | 0 |
| diagnostics | 768 | light | 0 | no | 0 | 0 | - | 0 |
| compute-settings | 768 | light | 0 | no | 0 | 0 | - | 0 |
| overview | 390 | light | 0 | no | 0 | 1 | - | 0 |
| analysis | 390 | light | 0 | yes | 8 | 1 | - | 0 |
| members | 390 | light | color-contrast×1 | no | 0 | 1 | - | 0 |
| leave | 390 | light | 0 | yes | 8 | 1 | - | 0 |
| units | 390 | light | 0 | yes | 8 | 1 | DEPT_OF_CARDIAC_ANAESTHESIA, DEPT_OF_NEUROANAESTHESIA, UNIT_I, UNIT_II, UNIT_III, UNIT_IV | 0 |
| rota-setup | 390 | light | select-name×8 | no | 0 | 1 | DEPT_OF_CARDIAC_ANAESTHESIA, DEPT_OF_NEUROANAESTHESIA, UNIT_I, UNIT_II, UNIT_III, UNIT_IV | 0 |
| rota-template | 390 | light | aria-allowed-attr×4, aria-required-children×1 | yes | 8 | 1 | - | 0 |
| rota-review | 390 | light | scrollable-region-focusable×7 | yes | 1 | 1 | - | 0 |
| rota-publish | 390 | light | 0 | no | 0 | 1 | - | 0 |
| user-guide | 390 | light | 0 | no | 0 | 1 | - | 0 |
| rota-rules | 390 | light | 0 | no | 0 | 1 | MAIN_1ST_24HR, MAIN_1ST_CO_24HR, MAIN_2ND_24HR, MAIN_3RD_24HR, MAIN_4TH_24HR, MAIN_CO3RD_24HR | 0 |
| call-clusters | 390 | light | target-size×1 | no | 0 | 1 | - | 0 |
| mappings | 390 | light | 0 | no | 0 | 1 | - | 0 |
| imports | 390 | light | 0 | no | 0 | 1 | - | 0 |
| accounts | 390 | light | 0 | no | 0 | 1 | - | 0 |
| diagnostics | 390 | light | 0 | no | 0 | 1 | - | 0 |
| compute-settings | 390 | light | 0 | no | 0 | 1 | - | 0 |
| overview | 1440 | dark | color-contrast×7 | no | 0 | 0 | - | 0 |
| analysis | 1440 | dark | color-contrast×9, scrollable-region-focusable×2 | no | 0 | 0 | - | 0 |
| members | 1440 | dark | aria-allowed-attr×3, color-contrast×228 | no | 0 | 0 | - | 0 |
| leave | 1440 | dark | color-contrast×11 | no | 0 | 0 | - | 0 |
| units | 1440 | dark | color-contrast×28 | no | 0 | 0 | DEPT_OF_CARDIAC_ANAESTHESIA, DEPT_OF_NEUROANAESTHESIA, UNIT_I, UNIT_II, UNIT_III, UNIT_IV | 0 |
| rota-setup | 1440 | dark | color-contrast×7, select-name×8 | no | 0 | 0 | DEPT_OF_CARDIAC_ANAESTHESIA, DEPT_OF_NEUROANAESTHESIA, UNIT_I, UNIT_II, UNIT_III, UNIT_IV | 0 |
| rota-template | 1440 | dark | aria-allowed-attr×4, aria-required-children×1 | yes | 3 | 0 | - | 0 |
| rota-review | 1440 | dark | color-contrast×52 | no | 0 | 0 | - | 0 |
| rota-publish | 1440 | dark | 0 | no | 0 | 0 | - | 0 |
| user-guide | 1440 | dark | 0 | no | 0 | 0 | - | 0 |
| rota-rules | 1440 | dark | color-contrast×4 | no | 0 | 0 | MAIN_1ST_24HR, MAIN_1ST_CO_24HR, MAIN_2ND_24HR, MAIN_3RD_24HR, MAIN_4TH_24HR, MAIN_CO3RD_24HR | 0 |
| call-clusters | 1440 | dark | color-contrast×10, target-size×1 | no | 0 | 0 | - | 0 |
| mappings | 1440 | dark | color-contrast×5 | no | 0 | 0 | - | 0 |
| imports | 1440 | dark | color-contrast×4 | no | 0 | 0 | - | 0 |
| accounts | 1440 | dark | color-contrast×5 | no | 0 | 0 | - | 0 |
| diagnostics | 1440 | dark | 0 | no | 0 | 0 | - | 0 |
| compute-settings | 1440 | dark | 0 | no | 0 | 0 | - | 0 |
| overview | 1024 | dark | color-contrast×7 | yes | 2 | 0 | - | 0 |
| analysis | 1024 | dark | color-contrast×9 | yes | 8 | 0 | - | 0 |
| members | 1024 | dark | aria-allowed-attr×3, color-contrast×228 | yes | 8 | 0 | - | 0 |
| leave | 1024 | dark | color-contrast×11, scrollable-region-focusable×1 | yes | 8 | 0 | - | 0 |
| units | 1024 | dark | color-contrast×28, scrollable-region-focusable×1 | yes | 8 | 0 | DEPT_OF_CARDIAC_ANAESTHESIA, DEPT_OF_NEUROANAESTHESIA, UNIT_I, UNIT_II, UNIT_III, UNIT_IV | 0 |
| rota-setup | 1024 | dark | color-contrast×7, select-name×8 | yes | 3 | 0 | DEPT_OF_CARDIAC_ANAESTHESIA, DEPT_OF_NEUROANAESTHESIA, UNIT_I, UNIT_II, UNIT_III, UNIT_IV | 0 |
| rota-template | 1024 | dark | aria-allowed-attr×4, aria-required-children×1 | yes | 8 | 0 | - | 0 |
| rota-review | 1024 | dark | color-contrast×52, scrollable-region-focusable×7 | yes | 7 | 0 | - | 0 |
| rota-publish | 1024 | dark | 0 | yes | 4 | 0 | - | 0 |
| user-guide | 1024 | dark | 0 | yes | 2 | 0 | - | 0 |
| rota-rules | 1024 | dark | color-contrast×4 | no | 0 | 0 | MAIN_1ST_24HR, MAIN_1ST_CO_24HR, MAIN_2ND_24HR, MAIN_3RD_24HR, MAIN_4TH_24HR, MAIN_CO3RD_24HR | 0 |
| call-clusters | 1024 | dark | color-contrast×10, target-size×1 | yes | 3 | 0 | - | 0 |
| mappings | 1024 | dark | color-contrast×5, scrollable-region-focusable×1 | yes | 2 | 0 | - | 0 |
| imports | 1024 | dark | color-contrast×4 | yes | 3 | 0 | - | 0 |
| accounts | 1024 | dark | color-contrast×5 | yes | 2 | 0 | - | 0 |
| diagnostics | 1024 | dark | 0 | no | 0 | 0 | - | 0 |
| compute-settings | 1024 | dark | 0 | no | 0 | 0 | - | 0 |
| overview | 768 | dark | color-contrast×7 | no | 0 | 0 | - | 0 |
| analysis | 768 | dark | color-contrast×9 | yes | 8 | 0 | - | 0 |
| members | 768 | dark | color-contrast×224 | no | 0 | 0 | - | 0 |
| leave | 768 | dark | color-contrast×5 | no | 0 | 0 | - | 0 |
| units | 768 | dark | color-contrast×23 | no | 0 | 0 | DEPT_OF_CARDIAC_ANAESTHESIA, DEPT_OF_NEUROANAESTHESIA, UNIT_I, UNIT_II, UNIT_III, UNIT_IV | 0 |
| rota-setup | 768 | dark | color-contrast×7, select-name×8 | no | 0 | 0 | DEPT_OF_CARDIAC_ANAESTHESIA, DEPT_OF_NEUROANAESTHESIA, UNIT_I, UNIT_II, UNIT_III, UNIT_IV | 0 |
| rota-template | 768 | dark | aria-allowed-attr×4, aria-required-children×1 | yes | 2 | 0 | - | 0 |
| rota-review | 768 | dark | color-contrast×52 | yes | 1 | 0 | - | 0 |
| rota-publish | 768 | dark | 0 | no | 0 | 0 | - | 0 |
| user-guide | 768 | dark | 0 | no | 0 | 0 | - | 0 |
| rota-rules | 768 | dark | color-contrast×4 | no | 0 | 0 | MAIN_1ST_24HR, MAIN_1ST_CO_24HR, MAIN_2ND_24HR, MAIN_3RD_24HR, MAIN_4TH_24HR, MAIN_CO3RD_24HR | 0 |
| call-clusters | 768 | dark | color-contrast×10, target-size×1 | no | 0 | 0 | - | 0 |
| mappings | 768 | dark | 0 | no | 0 | 0 | - | 0 |
| imports | 768 | dark | color-contrast×4 | no | 0 | 0 | - | 0 |
| accounts | 768 | dark | 0 | no | 0 | 0 | - | 0 |
| diagnostics | 768 | dark | 0 | no | 0 | 0 | - | 0 |
| compute-settings | 768 | dark | 0 | no | 0 | 0 | - | 0 |
| overview | 390 | dark | color-contrast×7 | no | 0 | 1 | - | 0 |
| analysis | 390 | dark | color-contrast×9 | yes | 8 | 1 | - | 0 |
| members | 390 | dark | color-contrast×224 | no | 0 | 1 | - | 0 |
| leave | 390 | dark | color-contrast×5 | yes | 8 | 1 | - | 0 |
| units | 390 | dark | color-contrast×23 | yes | 8 | 1 | DEPT_OF_CARDIAC_ANAESTHESIA, DEPT_OF_NEUROANAESTHESIA, UNIT_I, UNIT_II, UNIT_III, UNIT_IV | 0 |
| rota-setup | 390 | dark | color-contrast×7, select-name×8 | no | 0 | 1 | DEPT_OF_CARDIAC_ANAESTHESIA, DEPT_OF_NEUROANAESTHESIA, UNIT_I, UNIT_II, UNIT_III, UNIT_IV | 0 |
| rota-template | 390 | dark | aria-allowed-attr×4, aria-required-children×1 | yes | 8 | 1 | - | 0 |
| rota-review | 390 | dark | color-contrast×52, scrollable-region-focusable×7 | yes | 1 | 1 | - | 0 |
| rota-publish | 390 | dark | 0 | no | 0 | 1 | - | 0 |
| user-guide | 390 | dark | 0 | no | 0 | 1 | - | 0 |
| rota-rules | 390 | dark | color-contrast×4 | no | 0 | 1 | MAIN_1ST_24HR, MAIN_1ST_CO_24HR, MAIN_2ND_24HR, MAIN_3RD_24HR, MAIN_4TH_24HR, MAIN_CO3RD_24HR | 0 |
| call-clusters | 390 | dark | color-contrast×10, target-size×1 | no | 0 | 1 | - | 0 |
| mappings | 390 | dark | 0 | no | 0 | 1 | - | 0 |
| imports | 390 | dark | color-contrast×4 | no | 0 | 1 | - | 0 |
| accounts | 390 | dark | 0 | no | 0 | 1 | - | 0 |
| diagnostics | 390 | dark | 0 | no | 0 | 1 | - | 0 |
| compute-settings | 390 | dark | 0 | no | 0 | 1 | - | 0 |
