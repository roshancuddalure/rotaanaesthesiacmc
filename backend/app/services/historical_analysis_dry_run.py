import argparse
import csv
import json
import re
from calendar import monthrange
from collections import Counter, defaultdict
from dataclasses import asdict, dataclass
from datetime import date, datetime
from pathlib import Path
from typing import Iterable

from sqlalchemy import delete, select

from app.domain.duty_types import MAIN_24HR_KEYS
from app.models import Person
from app.models.imports import ImportBatch, ImportSourceRecord, ImportWarning
from app.models.person import PersonAlias
from app.models.posting import PersonPosting
from app.models.rota import DutyAssignment, DutySlot, RotaPeriod
from app.models.unit import Unit
from app.services.department_roster_reset import extract_clean_roster_members
from app.services.imports import (
    ParseWarning,
    ParsedRotaAssignment,
    ParsedUnitPosting,
    classify_duty_label,
    clean_person_name,
    is_valid_person_name,
    parse_rota_workbook,
    parse_unitwise_workbook,
)

try:
    from app.db.session import SessionLocal
except Exception:  # pragma: no cover - allows offline roster-file dry runs.
    SessionLocal = None  # type: ignore[assignment]


REPO_DIR = Path(__file__).resolve().parents[3]
DEFAULT_HISTORICAL_DIR = REPO_DIR / "data" / "source" / "historical"
DEFAULT_OUTPUT_DIR = REPO_DIR / "Plan" / "Data" / "analysis_rebuild"
DEFAULT_REFERENCE_HTML = REPO_DIR / "Plan" / "Data" / "CMC_Duty_Analysis_v5.html"
TRUSTED_ROSTER_PATH = REPO_DIR / "Plan" / "Data" / "ANAESTHESIA department doctors(namelist).xlsx"
DEFAULT_ALIAS_SUGGESTIONS = DEFAULT_OUTPUT_DIR / "alias_suggestions.csv"
DEFAULT_MATCHED_DUTIES = DEFAULT_OUTPUT_DIR / "matched_duties.csv"
DEFAULT_MATCHED_POSTINGS = DEFAULT_OUTPUT_DIR / "matched_postings.csv"
ACCEPTED_ALIAS_REASONS = {
    "unique_first_name",
    "ordered_token_variant",
    "first_last",
    "first_name_last_initial",
    "compact_exact",
}

TWENTY_FOUR_HOUR_TYPES = {
    "CART",
    "FIFTH_CALL",
    "SCHELL_24HR",
    "FLOATING_24HR",
}
HISTORICAL_IMPORT_SOURCES = {
    "historical_import",
    "historical_analysis_import",
}
HISTORICAL_IMPORT_KINDS = {
    "historical_rota",
    "historical_unitwise",
    "historical_analysis_rebuild",
}
MANUAL_ALIAS_OVERRIDES = {
    "pradeeshya": "Pradeeshya Parthiban",
    "pradeeshyaparthiban": "Pradeeshya Parthiban",
    "pradeeshyaparthibhan": "Pradeeshya Parthiban",
    "jerin": "Jerin Daniel D",
    "jerindaniel": "Jerin Daniel D",
    "jerindanield": "Jerin Daniel D",
    "raichel": "Raichel Kurian",
    "raichelkurian": "Raichel Kurian",
    "raichelkurien": "Raichel Kurian",
    "annielyn": "Annielyn Benitta P J",
    "annielynb": "Annielyn Benitta P J",
    "annieylb": "Annielyn Benitta P J",
    "anneilyn": "Annielyn Benitta P J",
    "annielynbenittapj": "Annielyn Benitta P J",
    "anjali": "Anjali Rachel Mathew",
    "anjalir": "Anjali Rachel Mathew",
    "anjalirachelmathew": "Anjali Rachel Mathew",
    "anjalirachaelmathew": "Anjali Rachel Mathew",
    "anton": "Anton Max Cassella Kumar",
    "antonm": "Anton Max Cassella Kumar",
    "antonmax": "Anton Max Cassella Kumar",
    "antonmaxcasella": "Anton Max Cassella Kumar",
    "antonmaxcassellakumar": "Anton Max Cassella Kumar",
    "vejans": "Vejans Vishal Antony V",
    "vejansv": "Vejans Vishal Antony V",
    "vejansvishalantony": "Vejans Vishal Antony V",
    "vejansvishalantonyv": "Vejans Vishal Antony V",
    "alwin": "Alwin Mesak K",
    "alwinm": "Alwin Mesak K",
    "alwinmesak": "Alwin Mesak K",
    "alwinmesakk": "Alwin Mesak K",
    "edward": "Edward Lourdes Roshan A",
    "edwardlourde": "Edward Lourdes Roshan A",
    "edwardlourderoshan": "Edward Lourdes Roshan A",
    "edwardlourdesroshana": "Edward Lourdes Roshan A",
    "velu": "Velu Ranganathan",
    "velurenganathan": "Velu Ranganathan",
    "veluranganathan": "Velu Ranganathan",
    "madhumita": "Madhumitha P S",
    "madumitha": "Madhumitha P S",
    "madhumitha": "Madhumitha P S",
    "madhumithaps": "Madhumitha P S",
    "jenifer": "Jennifer A",
    "jenifera": "Jennifer A",
    "jennifer": "Jennifer A",
    "jennifera": "Jennifer A",
    "preethi elizabeth kurian".replace(" ", ""): "Preethi Elizabeth Kurian",
    "preethielizabethkurian": "Preethi Elizabeth Kurian",
    "preethikurian": "Preethi Elizabeth Kurian",
    "preethikuryan": "Preethi Elizabeth Kurian",
    "samcharles": "Samcharles D",
    "samcharlesd": "Samcharles D",
    "samc": "Samcharles D",
    "samuelchandran": "Samuel David Chandran",
    "samueldaivdchandran": "Samuel David Chandran",
    "samueldavidchandran": "Samuel David Chandran",
    "samdavid": "Samuel David Chandran",
    "pradeepdaniel": "Pradeep Daniel",
    "pradeepk": "Pradeep Daniel",
    "danieljonathanroy": "Daniel Jonathan Roy L",
    "danieljonathanroyl": "Daniel Jonathan Roy L",
    "shanmugam": "Shanmuga Sundaram",
    "shanmugham": "Shanmuga Sundaram",
    "shanmugasundaram": "Shanmuga Sundaram",
    "shanmughasundaram": "Shanmuga Sundaram",
    "tamizhanban": "Thamizhanban D",
    "tamizanban": "Thamizhanban D",
    "thamizanban": "Thamizhanban D",
    "thamizhanban": "Thamizhanban D",
    "thamizhanband": "Thamizhanban D",
    "vimal": "Vimal B",
    "vimalbabu": "Vimal B",
    "meghna": "Meghna S David",
    "meghnasdavid": "Meghna S David",
    "savarin": "Savarin Jebha J",
    "savarinjebha": "Savarin Jebha J",
    "karthik": "Karthik S",
    "karthicks": "Karthik S",
    "karthiks": "Karthik S",
    "davidk": "Karumuru David Raj",
    "karumurudavidraj": "Karumuru David Raj",
    "davidsamsonrontala": "David Samson Rontala",
    "divya": "Divya J",
    "divyaj": "Divya J",
    "chris": "Chris Maria Joseph",
    "chrismariaj": "Chris Maria Joseph",
    "chrismariajoseph": "Chris Maria Joseph",
    "lilly": "Lilly Sophia M",
    "lillysophia": "Lilly Sophia M",
    "lillysophiam": "Lilly Sophia M",
    "ajay": "Ajay A",
    "ajaya": "Ajay A",
    "prem": "Prem Jepina P",
    "premjepina": "Prem Jepina P",
    "premjepinap": "Prem Jepina P",
    "joe": "Joe Renitta S",
    "joerenitta": "Joe Renitta S",
    "joerenittas": "Joe Renitta S",
    "james": "James Thapa Magar",
    "jamesthapam": "James Thapa Magar",
    "jamesthapamagar": "James Thapa Magar",
    "joanna": "Joanna",
    "joannaemmanuel": "Joanna Emmanuel",
    "joana": "Joanna Emmanuel",
    "joannaimmanuel": "Joanna Emmanuel",
    "pavithrap": "Pavithra",
    "sowmya": "Sowmya A",
    "soumya": "Sowmya A",
    "soumiya": "Sowmya A",
    "sowmyaa": "Sowmya A",
    "saumya": "Saumya Sheona Loyal",
    "saumyasheonaloyal": "Saumya Sheona Loyal",
    "jacintha": "Jacintha Gracelin J",
    "jacinthagracelinej": "Jacintha Gracelin J",
    "graceline": "Graceline Vandana N",
    "gracelinevandanan": "Graceline Vandana N",
    "yuvrajk": "Yuvaraj K",
    "yuvarajk": "Yuvaraj K",
    "sudarshan": "Sudharsan T R",
    "sudharshan": "Sudharsan T R",
    "sudharsan": "Sudharsan T R",
    "sudharsantr": "Sudharsan T R",
    "sudharshantr": "Sudharsan T R",
    "navfal": "Navfal Mohamed S A",
    "navfalmohammedsa": "Navfal Mohamed S A",
    "rvignesh": "Vignesh R",
    "vighnesh": "Vignesh R",
    "vignesh": "Vignesh R",
    "angelyna": "Angelin Aniruth",
    "angelin": "Angelin Aniruth",
    "angelina": "Angelin Aniruth",
    "angelinaniruth": "Angelin Aniruth",
    "angelinanirudha": "Angelin Aniruth",
    "angelineanirudha": "Angelin Aniruth",
    "sinduja": "Sindhuja D K",
    "sindhuja": "Sindhuja D K",
    "sindhujadk": "Sindhuja D K",
    "jeeva": "Jeeva Priscilla D M",
    "jeevapriscilladm": "Jeeva Priscilla D M",
    "jonas": "Jona Samraj D",
    "jonasamrajd": "Jona Samraj D",
    "jonathanjoseph": "Jonathan Joseph",
    "priyadarshinis": "Priyadharshini S",
    "priyadharshinis": "Priyadharshini S",
    "priyadarshni": "Priyadharshini S",
    "priyadarshnis": "Priyadharshini S",
    "priyadharshini": "Priyadharshini S",
    "priyadharshiniortho": "Priyadharshini S",
    "priyadharshiniobg": "Priyadharshini S",
    "priyadharshiniurology": "Priyadharshini S",
    "priyadharshinictvs": "Priyadharshini S",
    "priyadharshinikpaeds": "Priyadharshini S",
    "priyadharshinik": "Priyadharshini S",
    "shanmuga": "Shanmuga Sundaram",
    "shamugam": "Shanmuga Sundaram",
    "shanmughasundrum": "Shanmuga Sundaram",
    "shanmughasundharam": "Shanmuga Sundaram",
    "tamizhanabn": "Thamizhanban D",
    "thamizan": "Thamizhanban D",
    "thamizhanaban": "Thamizhanban D",
    "rohithb": "Buddula Rohith",
    "buddularohith": "Buddula Rohith",
    "nandhinis": "Nanthini S",
    "nanthinis": "Nanthini S",
    "emyhannah": "Emy Hanna Moni",
    "emyhannamoni": "Emy Hanna Moni",
    "karthickpandiyan": "Karthikpandian S",
    "karthikpandiyan": "Karthikpandian S",
    "karthikpandians": "Karthikpandian S",
    "vineeth": "Vineeth Indla",
    "kaviyas": "Kaviya Sree",
    "calwin": "Calvin Lawrence Dalmeida",
    "calvin": "Calvin Lawrence Dalmeida",
    "calwinlawrence": "Calvin Lawrence Dalmeida",
    "calwinlawrencedalmeida": "Calvin Lawrence Dalmeida",
    "calvinlawrencedalmeida": "Calvin Lawrence Dalmeida",
    "divyalak": "Divyalakshmi",
    "divyalakshmi": "Divyalakshmi",
    "kavi": "Kaviarasan",
    "kaviarasan": "Kaviarasan",
    "kaviarsan": "Kaviarasan",
    "mathew": "Mathews Joji",
    "matthew": "Mathews Joji",
    "mathews": "Mathews Joji",
    "mattews": "Mathews Joji",
    "matthewj": "Mathews Joji",
    "mathewsjo": "Mathews Joji",
    "mathewsjoji": "Mathews Joji",
    "naveenkopakka": "Koppaka Naveen Kumar",
    "naveenkoppaka": "Koppaka Naveen Kumar",
    "christinar": "Christina Reshma R",
    "christinareshmar": "Christina Reshma R",
    "christinat": "Christina Thomas",
    "christinathomas": "Christina Thomas",
    "aneesha": "Aneesha Chris W",
    "aneeshac": "Aneesha Chris W",
    "aneeshacris": "Aneesha Chris W",
    "aneeshachris": "Aneesha Chris W",
    "aneeshachrisw": "Aneesha Chris W",
    "aneeshachriswilfred": "Aneesha Chris W",
    "emelia": "Emilia Mary Pushparaj",
    "emilya": "Emilia Mary Pushparaj",
    "emiliamarypushparaj": "Emilia Mary Pushparaj",
    "praisev": "V Praise Prudveer Nazson",
    "praisevp": "V Praise Prudveer Nazson",
    "vpraiseprudveernazson": "V Praise Prudveer Nazson",
    "nandhini": "Nanthini S",
    "nandini": "Nanthini S",
    "elwis": "Elvis Fabian Peters",
    "elvisfabianpetre": "Elvis Fabian Peters",
    "elvisfabianpeters": "Elvis Fabian Peters",
    "selvinderanp": "Selvendiran P",
    "selvendiranp": "Selvendiran P",
    "ajayashok": "Ajay A",
    "joseph": "Joseph A P",
    "josephap": "Joseph A P",
    "rmawii": "Ramengmawii Khawlhring",
    "ramengmawiikhawlhring": "Ramengmawii Khawlhring",
    "prathimaroys": "Prathima Roys",
    "meetag": "Meeta G",
    "mispah": "Jammi Mizpah Shen",
    "jammimizpahshen": "Jammi Mizpah Shen",
    "tirzahnm": "Trizah Narayana Moorthy",
    "trizahnarayanamoorthy": "Trizah Narayana Moorthy",
    "pornima": "Poornima K",
    "poornimak": "Poornima K",
    "joufin": "Jofin F A",
    "jofinfa": "Jofin F A",
    "jimsahi": "Jim Shahi G S",
    "jimshahigs": "Jim Shahi G S",
    # ── Canonical name fixes (mapping old wrong-target aliases to correct dept names) ──
    "kishore": "Kishorekumar D",
    "kishorekumard": "Kishorekumar D",
    "kishorekumar": "Kishorekumar D",
    "kishorefn": "Kishorekumar D",
    "kishorehanson": "Kishorekumar D",
    "jeevap": "Jeeva Priscilla D M",
    "jeevapriscilla": "Jeeva Priscilla D M",
    "jevevap": "Jeeva Priscilla D M",
    "jeevapricilla": "Jeeva Priscilla D M",
    "roshnib": "Roshini Benedicta R",
    "roshnibenedicta": "Roshini Benedicta R",
    "roshni": "Roshini Benedicta R",
    "roshinibenedictar": "Roshini Benedicta R",
    "mahlah": "Sudi Cuty Mahlah",
    "smahalah": "Sudi Cuty Mahlah",
    "mahala": "Sudi Cuty Mahlah",
    "mahalah": "Sudi Cuty Mahlah",
    "mahla": "Sudi Cuty Mahlah",
    "sudycutymahlah": "Sudi Cuty Mahlah",
    "sudicutymahlah": "Sudi Cuty Mahlah",
    "sudycutymahalah": "Sudi Cuty Mahlah",
    "sudycutimahlah": "Sudi Cuty Mahlah",
    "tirzah": "Trizah Narayana Moorthy",
    "tirzahnarayanamoorthy": "Trizah Narayana Moorthy",
    "tirzahnaryanamoorthy": "Trizah Narayana Moorthy",
    "tirzhanaryanamoorthy": "Trizah Narayana Moorthy",
    "tirzahnarayanamoorti": "Trizah Narayana Moorthy",
    "rahavi": "Rahavi Rajendran",
    "rahavirajendran": "Rahavi Rajendran",
    "mizpah": "Jammi Mizpah Shen",
    "jammimizpah": "Jammi Mizpah Shen",
    "jamimizpahshen": "Jammi Mizpah Shen",
    "nissi": "Dity Nissi",
    "dittynissi": "Dity Nissi",
    "ditynissi": "Dity Nissi",
    "ditty": "Dity Nissi",
    "jonathans": "Jonathan Samuel B",
    "jonathansamuelb": "Jonathan Samuel B",
    "jonathansb": "Jonathan Samuel B",
    "jim": "Jim Shahi G S",
    "jimshai": "Jim Shahi G S",
    "emy": "Emy Hanna Moni",
    "emmyhanna": "Emy Hanna Moni",
    "emmyhannamoni": "Emy Hanna Moni",
    "emihannah": "Emy Hanna Moni",
    "emihannahmoni": "Emy Hanna Moni",
    "emiliah": "Emy Hanna Moni",
    "mawii": "Ramengmawii Khawlhring",
    "ramengmawii": "Ramengmawii Khawlhring",
    "ramengmawikhawlring": "Ramengmawii Khawlhring",
    "ramengmawiikhawlring": "Ramengmawii Khawlhring",
    "ramengmawiikhwalring": "Ramengmawii Khawlhring",
    "abella": "Jebamalai Rita Abella K",
    "abellaj": "Jebamalai Rita Abella K",
    "jebamalairataabellak": "Jebamalai Rita Abella K",
    "abellajk": "Jebamalai Rita Abella K",
    "anishap": "Anisha Pauline L",
    "anishapauline": "Anisha Pauline L",
    "anishapaulinel": "Anisha Pauline L",
    "meeta": "Meeta G",
    "ken": "Ken Mathew",
    "kenmathew": "Ken Mathew",
    "steve": "T Steve Solomon",
    "steves": "T Steve Solomon",
    "tsteve": "T Steve Solomon",
    "tsteveSolomon": "T Steve Solomon",
    "tstevessolomon": "T Steve Solomon",
    "ria": "Ria Masih",
    "riamasih": "Ria Masih",
    "riamashi": "Ria Masih",
    "sujile": "Sujil Ebenezar Sam",
    "sujileb": "Sujil Ebenezar Sam",
    "sujilebenezarsam": "Sujil Ebenezar Sam",
    "rajesh": "Rajesh Ravi",
    "rajeshravi": "Rajesh Ravi",
    "premj": "Prem Jepina P",
    "harsha": "Harshavardhini R",
    "harshavardhini": "Harshavardhini R",
    "harshavardhinir": "Harshavardhini R",
    "harshvardhini": "Harshavardhini R",
    "harshvardhiinir": "Harshavardhini R",
    "johnarun": "John Arun Kumar J",
    "johnarunk": "John Arun Kumar J",
    "johnarunkumarj": "John Arun Kumar J",
    "eva": "Eva Kumari",
    "evakumari": "Eva Kumari",
    "immanuelc": "Immanuel Christopher J",
    "immanuelchristopherj": "Immanuel Christopher J",
    "immannuel": "Immanuel Christopher J",
    "ranjithakv": "Ranjitha K V",
    "arulnirmal": "Arul Nirmal Raj S",
    "arulnirmalrajs": "Arul Nirmal Raj S",
    "praise": "V Praise Prudveer Nazson",
    "praisepv": "V Praise Prudveer Nazson",
    "praiseprudveernazson": "V Praise Prudveer Nazson",
    "praiseprudveernazsonpaeds": "V Praise Prudveer Nazson",
    "praiseprudveernasonpaeds": "V Praise Prudveer Nazson",
    "priaseprudveernazson": "V Praise Prudveer Nazson",
    "irfath": "Mohammed Irfath Khan B",
    "mdirfath": "Mohammed Irfath Khan B",
    "mohdirfath": "Mohammed Irfath Khan B",
    "mohdirfathkhan": "Mohammed Irfath Khan B",
    "mohammedirfathkhanb": "Mohammed Irfath Khan B",
    "mohdirfathkhanb": "Mohammed Irfath Khan B",
    "mohirfathkhan": "Mohammed Irfath Khan B",
    "mohamedirfathkhanb": "Mohammed Irfath Khan B",
    "shijimol": "Shijimol G",
    "shijimolg": "Shijimol G",
    "shjimolg": "Shijimol G",
    "jenos": "Jeno Shelton V",
    "jenoshelton": "Jeno Shelton V",
    "jenosheltonv": "Jeno Shelton V",
    "karthikp": "Karthikpandian S",
    "karthikpandian": "Karthikpandian S",
    "kartikpandian": "Karthikpandian S",
    "smithae": "Smitha Elizabeth George",
    "smithaelizabethgeorge": "Smitha Elizabeth George",
    "smithaeg": "Smitha Elizabeth George",
    "dilfa": "Dilfa Sharon",
    "dilfasharon": "Dilfa Sharon",
    "sakshi": "Sakshi Harris",
    "sakshiharris": "Sakshi Harris",
    "sharonje": "Sharon J Ebenezer",
    "sharonj": "Sharon J Ebenezer",
    "sharon": "Sharon J Ebenezer",
    "sharonebenezor": "Sharon J Ebenezer",
    "sharonebenezer": "Sharon J Ebenezer",
    "sharonebenezorbp": "Sharon J Ebenezer",
    "andrea": "Andrea Cris",
    "andreacris": "Andrea Cris",
    "prerna": "Prerna Nayan",
    "prernanayan": "Prerna Nayan",
    "prashin": "Prashin L R P",
    "prashinlrp": "Prashin L R P",
    "prasinlrp": "Prashin L R P",
    "prasin": "Prashin L R P",
    # Context-resolved names
    "naveen": "Koppaka Naveen Kumar",
    "kopakkanaveen": "Koppaka Naveen Kumar",
    "kopakkanaveenkumarctvs": "Koppaka Naveen Kumar",
    "kopakkanaveenkumar": "Koppaka Naveen Kumar",
    "kopakkanaveenk": "Koppaka Naveen Kumar",
    "kopakanavienkumar": "Koppaka Naveen Kumar",
    "kopakanavieen": "Koppaka Naveen Kumar",
    "preethi": "Preethi A",            # bare "preethi" in 4th call = Preethi A
    "preethia": "Preethi A",
    "joel": "Joel Koil Raj J",         # bulk 2025 entries are Joel Koil Raj
    "joelkr": "Joel Koil Raj J",
    "joelkoilraj": "Joel Koil Raj J",
    "joelkoilrajj": "Joel Koil Raj J",
    "joelkj": "Joel Koil Raj J",
    "joelvp": "Joel Vasanth Peter",
    "joelvasanthpeter": "Joel Vasanth Peter",
    "joeld": "Joel Daniel",
    "joeldaniel": "Joel Daniel",
    # ── Second batch: additional resolved names ───────────────────────────────
    "manjunath": "Manjunath",
    "pavithra": "Pavithra",
    "sam": "Samcharles D",             # 1st/2nd call entries → Sam Charles D
    "sugashini": "Sugashini",
    "sughasini": "Sugashini",
    "sharonkc": "Sharon Kavya Chandana P",
    "sharonkavya": "Sharon Kavya Chandana P",
    "sharonkavyachandanap": "Sharon Kavya Chandana P",
    "sahronk": "Sharon Kavya Chandana P",
    "anitas": "Anita Shirley Joselyn",
    "anitashirleyjoselyn": "Anita Shirley Joselyn",
    "anitashirley": "Anita Shirley Joselyn",
    "angelinema": "Angeline Mary Abraham",
    "angelinemaryabraham": "Angeline Mary Abraham",
    "yuvraj": "Yuvaraj K",
    "divyaaj": "Divya J",
    "diivyaaj": "Divya J",
    "shruthis": "Shruti Singh",
    "shruthi": "Shruti Singh",
    "shruthistingh": "Shruti Singh",
    "shruthisingh": "Shruti Singh",
    "anjue": "Anju Emma Brillin",
    "anjuemma": "Anju Emma Brillin",
    "anjuemmabrillin": "Anju Emma Brillin",
    "anjueb": "Anju Emma Brillin",
    "jeenu": "Jeenu Ann Jose",         # CART/2nd-3rd call → Jeenu Ann Jose
    "jeenuannjose": "Jeenu Ann Jose",
    "jeenijose": "Jeenu Ann Jose",
    "jeenujose": "Jeenu Ann Jose",
    "jeeenujose": "Jeenu Ann Jose",
    "riyas": "Riya Sarah Abraham",
    "riyasarahabraham": "Riya Sarah Abraham",
    "joerenita": "Joe Renitta S",
    "abhishma": "Abishma A M",
    "abhishmaam": "Abishma A M",
    "abishmaam": "Abishma A M",
    "abishma": "Abishma A M",
    "vino": "Vinobharathi E",
    "vinob": "Vinobharathi E",
    "vinobharathi": "Vinobharathi E",
    "vinobharathie": "Vinobharathi E",
    "vionbarathi": "Vinobharathi E",
    "vinobharti": "Vinobharathi E",
    "vinobharathy": "Vinobharathi E",
    "subha": "Subhavarshini M",
    "subhavarshini": "Subhavarshini M",
    "subhavarshinim": "Subhavarshini M",
    "subhavarshim": "Subhavarshini M",
    "subavarshini": "Subhavarshini M",
    "rohanjt": "Rohan Jacob Titus",
    "rohanjacob": "Rohan Jacob Titus",
    "rohanjacobtiuts": "Rohan Jacob Titus",
    "rohanjacobT": "Rohan Jacob Titus",
    "rohanc": "Rohan Chacko Jacob",
    "rohanchacko": "Rohan Chacko Jacob",
    "rohanchackojacob": "Rohan Chacko Jacob",
    "nandiv": "Nandi Vinayaka B",
    "nandivinayakab": "Nandi Vinayaka B",
    "nandhiniv": "Nandi Vinayaka B",
    "hannahaugustine": "Hanna A",
    "hannah": "Hanna A",
    "hannaha": "Hanna A",
    "selvinderan": "Selvendiran P",
    "selvendiran": "Selvendiran P",
    "kaviyasri": "Kaviya",
    "kaviyasree": "Kaviya",
    "kaviyashri": "Kaviya",
    # ── Third batch: all remaining skipped names ──────────────────────────────
    # SERINA / KAREN → 5th call → ambiguous in original roster; now mapped
    "serina": "Serina Ruth Salin",
    "serinaruth": "Serina Ruth Salin",
    "serinaruthsalin": "Serina Ruth Salin",
    "serinaruthsalins": "Serina Ruth Salin",
    "karen": "Karen Ruby Lionel",
    "karenrubylionel": "Karen Ruby Lionel",
    "karenlionel": "Karen Ruby Lionel",
    # SATHISH → 5th call
    "sathish": "Sathish Kumar D",
    "sathishd": "Sathish Kumar D",
    "satishd": "Sathish Kumar D",
    "sathishkumard": "Sathish Kumar D",
    # SREE → Sreekumar M R (2026-04/05 Junior/Stroke call)
    "sree": "Sreekumar M R",
    "sreekumar": "Sreekumar M R",
    "sreekumarmr": "Sreekumar M R",
    # ANITA → 5th call
    "anita": "Anita Shirley Joselyn",
    # APARANJITH → 5th call; Aparanjit Paul
    "aparanjith": "Aparanjit Paul",
    "aparanjit": "Aparanjit Paul",
    "aparanjitpaul": "Aparanjit Paul",
    "aparana": "Aparanjit Paul",
    # TONY → 5th call Jan 2025; Tony Thomson Chandy
    "tony": "Tony Thomson Chandy",
    "tonythomsonchandy": "Tony Thomson Chandy",
    # David → PAC context; Karumuru David Raj
    "david": "Karumuru David Raj",
    "davidraj": "Karumuru David Raj",
    "kdavidraj": "Karumuru David Raj",
    # Samuel → 4th call; Samuel D C (department member)
    "samuel": "Samuel D C",
    "samueld": "Samuel D C",
    "samueldc": "Samuel D C",
    "samdc": "Samuel D C",
    # Jonathan → Schell/Shift 2026-03; Jonathan Samuel B
    "jonathan": "Jonathan Samuel B",
    # Anju → PAC/Shift 2026-03; Anju Emma Brillin
    "anju": "Anju Emma Brillin",
    # PRAVEEN → CB 4th call 2025-06; Praveen Benjamin D
    "praveen": "Praveen Benjamin D",
    "praveenbd": "Praveen Benjamin D",
    "praveenbenjamind": "Praveen Benjamin D",
    # Priyadarshini Kalahasthi. Bare Priyadarshini is context-resolved below.
    "priyadarshinikalahasthi": "Priyadarshini Kalahasthi",
    # John → 2nd call 2022 SR; John Arun Kumar J
    "john": "John Arun Kumar J",
    # Anisha → PAC final years 2022; Anisha Joy (senior)
    "anisha": "Anisha Joy",
    # KARTHI S / Karthi P → PAC; Karthik S / Karthikpandian S
    "karthis": "Karthik S",
    "karthi": "Karthik S",
    "karthip": "Karthikpandian S",
    # Franklin J → 2nd call 2022
    "franklinj": "Franklin Vedha Prabhu",
    "franklinvedha": "Franklin Vedha Prabhu",
    "franklinvedu": "Franklin Vedha Prabhu",
    "franklinvp": "Franklin Vedha Prabhu",
    "franklinvedhaprabhu": "Franklin Vedha Prabhu",
    "franklinjbp": "Franklin Vedha Prabhu",
    # Andrea Chris → 2nd/3rd call 2022 batch
    "andreaschris": "Andrea Cris",
    "andreachris": "Andrea Cris",
    "andreachrisbp": "Andrea Cris",
    "andreachrismiucusicuposting": "Andrea Cris",
    # Shwetha A / Shwetha → 1st call 2024 = Swetha A
    "shwetha": "Swetha A",
    "shwethaa": "Swetha A",
    "swethaa": "Swetha A",
    "swethab": "Swetha A",
    "swetha": "Swetha A",
    "shwethasicu": "Swetha A",
    # Beula P / Beaula P → Beaula P (official)
    "beulap": "Beaula P",
    "beulah": "Beaula P",
    "beulahp": "Beaula P",
    "beaula": "Beaula P",
    "beaulap": "Beaula P",
    "beula": "Beaula P",
    "beulapsicu": "Beaula P",
    "beulahpbpnov": "Beaula P",
    "beulaphpaed": "Beaula P",
    "beulapebeulap": "Beaula P",
    "beulaphctvs": "Beaula P",
    # Maria Anna Eldo → Maria Anna Eldho
    "mariaannaeldo": "Maria Anna Eldho",
    "mariaannaeldho": "Maria Anna Eldho",
    "mariaeldo": "Maria Anna Eldho",
    "mariaeldho": "Maria Anna Eldho",
    # Deepthi Dilip → Deepthi D
    "deepthidilip": "Deepthi D",
    "deepthidilipctvspt": "Deepthi D",
    "deepthid": "Deepthi D",
    # Ruth Tiga → Ruth Tigga
    "ruthtiga": "Ruth Tigga",
    "ruthtigga": "Ruth Tigga",
    # Nazreen Begum → Nasreen Begum K
    "nazreenbegum": "Nasreen Begum K",
    "nasreenbegum": "Nasreen Begum K",
    "nasreenbegumk": "Nasreen Begum K",
    "nasreenbegumsicuonly": "Nasreen Begum K",
    # Priyadharshini K → Priyadharshini S (unique context)
    # (these are all DM/PDF context → Priyadharshini S)
    # ACHINTIYA / Achintya / Achintya(PDF) → Achinthya Roopa Arul
    "achintiya": "Achinthya Roopa Arul",
    "achintya": "Achinthya Roopa Arul",
    "achintiyapdf": "Achinthya Roopa Arul",
    "achithiya": "Achinthya Roopa Arul",
    # Shree Kumar (DM Neuro) → Sreekumar M R
    "shreekumardmneuro": "Sreekumar M R",
    "shreekumar": "Sreekumar M R",
    # Jerolin / Jerolin(PDF) / Jerolin A → new person to add as Jerolin A
    "jerolin": "Jerolin A",
    "jerolin a": "Jerolin A",
    "jerolina": "Jerolin A",
    "jerolinpdf": "Jerolin A",
    # Mohd Irfath Khan → Mohammed Irfath Khan B
    "mohirfath": "Mohammed Irfath Khan B",
    # Abin Ipe / Abin → Abin Iype
    "abin": "Abin Iype",
    "abinipe": "Abin Iype",
    "abiniype": "Abin Iype",
    "abinipesicumicuposting": "Abin Iype",
    # Tamizhanban D → Thamizhanban D (already covered above, extra variants)
    "tamizhanband": "Thamizhanban D",
    # Devi Balasubramaniam → Devi Balasubramanyam
    "devibalasubramaniam": "Devi Balasubramanyam",
    "devibalasubhramanyam": "Devi Balasubramanyam",
    "devibalasubramanyam": "Devi Balasubramanyam",
    "devibalasubramaniyam": "Devi Balasubramanyam",
    "emmyhanamoni": "Emy Hanna Moni",
    # Savarin Jeba → Savarin Jebha J
    "savarinjeba": "Savarin Jebha J",
    "savarinjebhaj": "Savarin Jebha J",
    "savarin jeba": "Savarin Jebha J",
    # MOULESWARAN → Mouleeswaran S
    "mouleswaran": "Mouleeswaran S",
    "mouleeswaran": "Mouleeswaran S",
    "mouleeswaran s": "Mouleeswaran S",
    "mouleeswaran(am)": "Mouleeswaran S",
    "mouleswaranamashapmannm": "Mouleeswaran S",
    # SAMZI / Samzal L → Samzai Lungalang
    "samzi": "Samzai Lungalang",
    "samzall": "Samzai Lungalang",
    "samzallungalang": "Samzai Lungalang",
    "samzailungalang": "Samzai Lungalang",
    # ANNIEYL B → Annielyn Benitta P J (already covered above)
    # Emila / Emiloia → Emilia Mary Pushparaj
    "emila": "Emilia Mary Pushparaj",
    "emiloia": "Emilia Mary Pushparaj",
    "emiliyam": "Emilia Mary Pushparaj",
    "emiliya": "Emilia Mary Pushparaj",
    "emmiliamarypushparaj": "Emilia Mary Pushparaj",
    # Priscila → Priscilla S
    "priscila": "Priscilla S",
    "priscillas": "Priscilla S",
    "priscillasmaria": "Priscilla S",
    # NEES → Aneesha Chris W
    "nees": "Aneesha Chris W",
    # Joffin → Jofin F A
    "joffin": "Jofin F A",
    "joffinfa": "Jofin F A",
    # Febin Saji → Febin Shaji
    "febinsaji": "Febin Shaji",
    "febinshaji": "Febin Shaji",
    # Vency / Vensi Dhevena → Vensi Devena P
    "vency": "Vensi Devena P",
    "vensi": "Vensi Devena P",
    "vensidheveena": "Vensi Devena P",
    "vensidhevena": "Vensi Devena P",
    "vensidevena": "Vensi Devena P",
    "vensidevenap": "Vensi Devena P",
    # Jessica → Jassica Charles
    "jessica": "Jassica Charles",
    "jassica": "Jassica Charles",
    "jassicacharles": "Jassica Charles",
    # Mailaika → Malaika Abid Ansari
    "mailaika": "Malaika Abid Ansari",
    "malaika": "Malaika Abid Ansari",
    "malaikaabidansari": "Malaika Abid Ansari",
    # Pradheeshya / Praddepa → Pradeeshya Parthiban
    "pradheeshya": "Pradeeshya Parthiban",
    "praddepa": "Pradeeshya Parthiban",
    "pradheeshyajeninhelvispfabian": "Pradeeshya Parthiban",
    # Pardeepa → Pradeepa C
    "pardeepa": "Pradeepa C",
    "pradeepa": "Pradeepa C",
    "pradeepc": "Pradeepa C",
    # Yalini K P → Yaalini K P
    "yalinikp": "Yaalini K P",
    "yalini": "Yaalini K P",
    "yaalini": "Yaalini K P",
    "yaalinikp": "Yaalini K P",
    # BHARATH / Bharath Kumar → new member Bharath Kumar (keep as is)
    "bharath": "Bharath Kumar",
    "bharathkumar": "Bharath Kumar",
    # Jagan → new person in PAC 2025-03
    # Graceline → Graceline Vandana N
    "grceline": "Graceline Vandana N",
    "gracelinevn": "Graceline Vandana N",
    # Stepehen / Stephen Abishai → Stephen Abishai Barreto
    "stephen": "Stephen Abishai Barreto",
    "stephenabishai": "Stephen Abishai Barreto",
    "stepehenabishaibarreto": "Stephen Abishai Barreto",
    "stephenabishaibarreto": "Stephen Abishai Barreto",
    "stepehenabishaibarrito": "Stephen Abishai Barreto",
    "shanmughasundram": "Shanmuga Sundaram",
    # Sathyadev Jangam → Satyadev Jangam
    "sathyadevjangam": "Satyadev Jangam",
    "satyadevjangam": "Satyadev Jangam",
    # Amrita Pramod → new person
    "amritapramod": "Amrita Pramod",
    # Soumya Sheona Loyal → Saumya Sheona Loyal
    "soumyasheonaloyal": "Saumya Sheona Loyal",
    # Nafval Mohammed → Navfal Mohamed S A
    "nafvalmohammed": "Navfal Mohamed S A",
    "nafvalmohammedsa": "Navfal Mohamed S A",
    "navfalmohammed": "Navfal Mohamed S A",
    # Anoopa Elizabeth → Anoopa Elizabeth Oommen
    "anoopae": "Anoopa Elizabeth Oommen",
    "anoopaoommen": "Anoopa Elizabeth Oommen",
    "anoopaelizabethoommen": "Anoopa Elizabeth Oommen",
    # Anula A → Anula V
    "anulaa": "Anula V",
    "anulav": "Anula V",
    # Sadhanandha Reddy / Sadanandha → SADHANANDA
    "sadhanandha": "SADHANANDA",
    "sadanandha": "SADHANANDA",
    "sadhanandareddy": "SADHANANDA",
    "sadhananda": "SADHANANDA",
    # Narasimha Rao / Narasimma
    "narasimha": "Narasimha Rao",
    "narasimmarao": "Narasimha Rao",
    "narasimhrao": "Narasimha Rao",
    "narasimma": "Narasimha Rao",
    # Minu Rajan → Minu
    "minurajan": "Minu",
    "minurajanroselind": "Minu",
    # Zakam David Stanley → Zakkam David Stanley
    "zakamstanley": "Zakkam David Stanley",
    "zakamdavid": "Zakkam David Stanley",
    "zakamdavidstanley": "Zakkam David Stanley",
    "zakkamstanley": "Zakkam David Stanley",
    "zakkamds": "Zakkam David Stanley",
    "abellazakamdavid": "Zakkam David Stanley",
    # Srividya B → Srividhya B
    "srividyab": "Srividhya B",
    "srividhya": "Srividhya B",
    "srividhyab": "Srividhya B",
    # Durai Henry → new DM/PDF person
    "duraihenry": "Durai Henry",
    # Naveen Raj → new DM/PDF person
    "naveenraj": "Naveen Raj",
    # Geerthana M → new 1st call 2026-02 person
    "geerthanam": "Geerthana M",
    "geerthana": "Geerthana M",
    # Ram Prakash → new 1st call person
    "ramprakashr": "Ram Prakash R",
    "ramprakash": "Ram Prakash R",
    # KISHORE (FN) / SMITHAMOL (AN) → split; kishore = Kishorekumar D already handled
    "smithamol": "Smithamol P B",
    "smithamolpb": "Smithamol P B",
    "smithamolan": "Smithamol P B",
    # Mowli → new 1st call 2026-02
    "mowli": "Mowli",
    # Angeline Veronica → Angelyn Veronica? Check: both in DB as same person
    "angelineveronica": "Angelyn Veronica",
    "angelynveronica": "Angelyn Veronica",
    # Abhirami M → Abirami M
    "abhiramim": "Abirami M",
    "abhirami": "Abirami M",
    "abiramim": "Abirami M",
    # Calwin / CALWIN L → Calvin Lawrence Dalmeida
    # (already mapped above via calwin/calvin)
    # KIRUGHIGA → Kiruthiga
    "kirughiga": "Kiruthiga",
    "kirughigha": "Kiruthiga",
    # SOFIA → Sophia Nag
    "sofia": "Sophia Nag",
    "sophianag": "Sophia Nag",
    # Suhasini → Sugashini? Or new person? It's CB C/S AM 2025-01
    "suhasini": "Sugashini",
    # Jona E → Jona Samraj D
    "jonae": "Jona Samraj D",
    "jonasamraj": "Jona Samraj D",
    "joanathan": "Jonathan Samuel B",
    "joanathansamuel": "Jonathan Samuel B",
    # Inba Idaya / Inbha Idaya → Inba Idhaya A
    "inbaidaya": "Inba Idhaya A",
    "inbaidhaya": "Inba Idhaya A",
    "inbhaidaya": "Inba Idhaya A",
    "inbhaidhaya": "Inba Idhaya A",
    "inbaidhayabp": "Inba Idhaya A",
    "inbhaidayabp": "Inba Idhaya A",
    "inbaidayaneuro": "Inba Idhaya A",
    "inbhaidayaneuro": "Inba Idhaya A",
    # ANDERW S → Andrew Solomon
    "andews": "Andrew Solomon",
    "andrewsolomon": "Andrew Solomon",
    "andrewmoses": "Andrew Solomon",
    # Prabakaran.S → Prabhakaran S
    "prabakarans": "Prabhakaran S",
    "prabhakarans": "Prabhakaran S",
    # Calvin Lawrence → already mapped
    "calvinlawrence": "Calvin Lawrence Dalmeida",
    "calwinlawrenece": "Calvin Lawrence Dalmeida",
    "calwinlawrewnce": "Calvin Lawrence Dalmeida",
    # Indla Joseph Vineeth → Indla Joseph Vineeth
    "indlajosephvineeth": "Indla Joseph Vineeth",
    "vineethindla": "Indla Joseph Vineeth",
    # Roham → Rohan Chacko Jacob (typo)
    "roham": "Rohan Chacko Jacob",
    "ramengmawikhwalring": "Ramengmawii Khawlhring",
    "sharonebenezar": "Sharon J Ebenezer",
    "praiseprudveernason": "V Praise Prudveer Nazson",
    "sudymahlah": "Sudi Cuty Mahlah",
    "sudymahlahtirzah": "Sudi Cuty Mahlah",
    "sudycutymahlahtirzah": "Sudi Cuty Mahlah",
    "samuelcherwinwesley": "Samuel Cherwin Wesley",
    "abhilashrn": "Abhilash R N",
    "jeromekumar": "Jerome Kumar",
    "sujathabhaskar": "Sujatha Bhaskar",
    "kishorek": "Kishorekumar D",
    "harshvardhani": "Harshavardhini R",
    "harshvardhir": "Harshavardhini R",
    "harshvardhanir": "Harshavardhini R",
    "sadhanandhareddy": "SADHANANDA",
    "anderws": "Andrew Solomon",
    "antrof": "Antrofelix M",
    "shanmugan": "Shanmuga Sundaram",
    "praiseprudveernazon": "V Praise Prudveer Nazson",
    # Immannuel → Immanuel Christopher J
    "immannuelc": "Immanuel Christopher J",
    # Aanton → Anton Max Cassella Kumar
    "aanton": "Anton Max Cassella Kumar",
    # ANTRO F → Antrofelix M
    "antro": "Antrofelix M",
    "antrofelix": "Antrofelix M",
    "antrofelixa": "Antrofelix M",
    "antrofelixm": "Antrofelix M",
    # Chritina R → Christina Reshma R
    "chritinar": "Christina Reshma R",
    # Emiloia → Emilia Mary Pushparaj
    # (already covered)
    # Soiphia → Sophia Nag
    "soiphia": "Sophia Nag",
    # NANDHI V → Nandi Vinayaka B
    "nandhiv": "Nandi Vinayaka B",
    # IRASHA MAL → Irasha Mall
    "irashamal": "Irasha Mall",
    "irashamall": "Irasha Mall",
    # MIZPHA → Jammi Mizpah Shen
    "mizpha": "Jammi Mizpah Shen",
    # Sudhrashan → Sudharsan T R
    "sudhrashan": "Sudharsan T R",
    # Lilli → Lilly Sophia M
    "lilli": "Lilly Sophia M",
    # Sugashnin → Sugashini
    "sugashnin": "Sugashini",
    # SOFIA → Sophia Nag (already done)
    # Narasimma → Narasimha Rao (already done)
    # Bitsy Regulus → Bitsy Regulas Bouvert
    "bitsyregulus": "Bitsy Regulas Bouvert",
    "bitsyregulasbouvert": "Bitsy Regulas Bouvert",
    # Manna Mary Mathew → Manna Mary Thomas
    "mannamarymathew": "Manna Mary Thomas",
    "mannamarythomas": "Manna Mary Thomas",
    "kopakanaveen": "Koppaka Naveen Kumar",
    "kopakanavenkumar": "Koppaka Naveen Kumar",
    "kopakanaveenkumar": "Koppaka Naveen Kumar",
    "kopakkanaveen(bp115)": "Koppaka Naveen Kumar",
    # Hanosn → Hanson J
    "hanosn": "Hanson J",
    "hansonj": "Hanson J",
    # Sahlu → Shalu Sharma
    "sahlu": "Shalu Sharma",
    "shalus": "Shalu Sharma",
    "shalusharmma": "Shalu Sharma",
    # Neenu / NEENU → Neenu Geo Thomas
    "neenu": "Neenu Geo Thomas",
    "neenugeo": "Neenu Geo Thomas",
    "neenugeothomas": "Neenu Geo Thomas",
    # Dhannya / Dhanya → Dhannya
    "dhanya": "Dhannya",
    # JONA E already handled
    # Vidhya S → Vidhya S (already in DB)
    "vidhya": "Vidhya S",
    "vidhyas": "Vidhya S",
    "vidyas": "Vidhya S",
    # Kashmira / KASHMIRA → Kashmira Robin George
    "kashmira": "Kashmira Robin George",
    "kashmirarobiingeorge": "Kashmira Robin George",
    "kashmirarobingeorge": "Kashmira Robin George",
    # Raichel Kurian / Raichel Kurien → Raichel Kurian (already fixed at top)
    # Rashika / Rasica → Rasica Dias
    "rasica": "Rasica Dias",
    "rasicadias": "Rasica Dias",
    # Poornima / Pornima → Poornima K
    "poornima": "Poornima K",
    # Monal Antony → Monal Antony A G (already Antrofelix ≠ Monal Antony)
    "monalantony": "Monal Antony A G",
    "monalantonyag": "Monal Antony A G",
    # RIYA / KAVI → split entry; map to Riya Sarah Abraham + Kaviarasan separately
    # (these are joint cells — skip as they can't be split automatically)
    # Angeline Anirutha → Angelin Aniruth
    "angelineanirutha": "Angelin Aniruth",
    "angelinanirutha": "Angelin Aniruth",
    "angelinaanirutha": "Angelin Aniruth",
    # Remaining DB duplicates to merge
    "annielynbenitapj": "Annielyn Benitta P J",
    "joerenitas": "Joe Renitta S",
    "sudanaveen": "Suda Naveen Kumar",
    "keerthana": "Keerthana A",
    "rakshana": "Rakshna K S",
    "sanjaykanth": "Sanjaykanth R",
    # Additional single-name stragglers
    "jagan": "Jagan",                           # PAC 2025-03 — new person
    "emilyapushparaj": "Emilia Mary Pushparaj",
    "nxonvedhaasiranthony": "Nixon Veda Asir Anthony",
    "moinicaj": "Monica J",
    "calvinlawrenece": "Calvin Lawrence Dalmeida",
    "kopakanaveenkumarctvs": "Koppaka Naveen Kumar",
    "mohamedirfathkhan": "Mohammed Irfath Khan B",
    "anoopaelizabethoomen": "Anoopa Elizabeth Oommen",
    # Date-suffixed names (e.g. 'Indla Joseph Vineeth( 04/03/2025)') — strip date suffix
    "indlajosephvineeth04": "Indla Joseph Vineeth",
    "riyalal04": "Riya Lal",
    "sarahsharma04": "Sarah Sharma",
    "minurajan18": "Minu",
    "narasimharao04": "Narasimha Rao",
    "ajayalex18": "Ajay A",
    "tirzahnarayanamoorthi": "Trizah Narayana Moorthy",
    "tirzhanarayanamoorthy": "Trizah Narayana Moorthy",
    "praiseprudeveer": "V Praise Prudveer Nazson",
    "vinobharathye": "Vinobharathi E",
    "matthews": "Mathews Joji",
    "preerna": "Prerna Nayan",
    "calwinl": "Calvin Lawrence Dalmeida",
    "karthikpan": "Karthikpandian S",
    "achitiya": "Achinthya Roopa Arul",
    "jevevapriscilla": "Jeeva Priscilla D M",
    "anneilynb": "Annielyn Benitta P J",
    "shanmughasudharam": "Shanmuga Sundaram",
    "stephenabhishaibarrito": "Stephen Abishai Barreto",
    "stephenabhishaibarreto": "Stephen Abishai Barreto",
}
# Multi-person cells: compact key → list of canonical names to assign the duty to both
MULTI_PERSON_SPLITS: dict[str, list[str]] = {
    "riyakavi": ["Riya Sarah Abraham", "Kaviarasan"],
    "riyanakavi": ["Riya Sarah Abraham", "Kaviarasan"],
    "andrewriyapraveenbkaviarasan": ["Andrew Solomon", "Riya Sarah Abraham", "Praveen Benjamin D", "Kaviarasan"],
    "andrewriyapraveen": ["Andrew Solomon", "Riya Sarah Abraham", "Praveen Benjamin D"],
    "praiseindba": ["V Praise Prudveer Nazson", "Inba Idhaya A"],
    "praiseinba": ["V Praise Prudveer Nazson", "Inba Idhaya A"],
    "mouleswaranasha": ["Mouleeswaran S", "Asha Devanand"],
    "mouleswaranamanasha": ["Mouleeswaran S", "Asha Devanand"],
    "mouleswaramashapmann": ["Mouleeswaran S", "Asha Devanand"],
    "alwindevi": ["Alwin Mesak K", "Devi Balasubramanyam"],
    "amitneenu": ["Amit Mathew", "Neenu Geo Thomas"],
    "amitamneenupm": ["Amit Mathew", "Neenu Geo Thomas"],
    "neenuriyas": ["Neenu Geo Thomas", "Riya Sarah Abraham"],
    "neenuriyasarahabraham": ["Neenu Geo Thomas", "Riya Sarah Abraham"],
    "shalushalu": ["Shalu Sharma", "Vimal B"],
    "shalussvimal": ["Shalu Sharma", "Vimal B"],
    "shaluvimal": ["Shalu Sharma", "Vimal B"],
    "inbhaidayamannamary": ["Inba Idhaya A", "Manna Mary Thomas"],
    "inbhaidayamannamarythomas": ["Inba Idhaya A", "Manna Mary Thomas"],
    "abishmamohdirfath": ["Abishma A M", "Mohammed Irfath Khan B"],
    "abishmamohammedirfath": ["Abishma A M", "Mohammed Irfath Khan B"],
    "ruthtiga joelkoil": ["Ruth Tigga", "Joel Koil Raj J"],
    "ruthtigajoelkoil": ["Ruth Tigga", "Joel Koil Raj J"],
    "kopakkanaveenkhawlring": ["Koppaka Naveen Kumar", "Ramengmawii Khawlhring"],
    "kopakkanaveenamilyapushparaj": ["Koppaka Naveen Kumar", "Emilia Mary Pushparaj"],
    "kopakkanaveenemilia": ["Koppaka Naveen Kumar", "Emilia Mary Pushparaj"],
    "priscillasmaria": ["Priscilla S", "Maria Anna Eldho"],
    "priscillasmariaeldo": ["Priscilla S", "Maria Anna Eldho"],
    "abellazakamdavid": ["Jebamalai Rita Abella K", "Zakkam David Stanley"],
    "sudymahlahtirzah": ["Sudi Cuty Mahlah", "Trizah Narayana Moorthy"],
    "sudycutymahlahtirzah": ["Sudi Cuty Mahlah", "Trizah Narayana Moorthy"],
    "tirzahmathewsjojikopakanaveen": ["Trizah Narayana Moorthy", "Mathews Joji", "Karumuru David Raj"],
    "tirzahmathewsjojikaviand": ["Trizah Narayana Moorthy", "Mathews Joji", "Karumuru David Raj"],
    "mariabitsymannapoor": ["Maria Anna Eldho", "Bitsy Regulas Bouvert", "Manna Mary Thomas", "Poornima K"],
    "mariabitsymannapoornima": ["Maria Anna Eldho", "Bitsy Regulas Bouvert", "Manna Mary Thomas", "Poornima K"],
    "jeevapanniely": ["Jeeva Priscilla D M", "Annielyn Benitta P J", "Preetha John"],
    "jeevapannielynbpreethajohn": ["Jeeva Priscilla D M", "Annielyn Benitta P J", "Preetha John"],
    "emymonicajangelin": ["Emy Hanna Moni", "Monica J", "Angelin Aniruth", "Eva Kumari", "Vimal B"],
    "emymonicajanglinaevavimalb": ["Emy Hanna Moni", "Monica J", "Angelin Aniruth", "Eva Kumari", "Vimal B"],
    "danicamiucusicuabin": ["Danica Lyngwa", "Abin Iype"],
    "danicaabin": ["Danica Lyngwa", "Abin Iype"],
    "kopakkanaveenemilyapushparaj": ["Koppaka Naveen Kumar", "Emilia Mary Pushparaj"],
    "kopakanaveen emiliyapushparaj": ["Koppaka Naveen Kumar", "Emilia Mary Pushparaj"],
    "mouleeswaranasha": ["Mouleeswaran S", "Asha Devanand"],
    "shalusvimal": ["Shalu Sharma", "Vimal B"],
    "tirzahmathewsjojikdavid": ["Trizah Narayana Moorthy", "Mathews Joji", "Karumuru David Raj"],
    "emymonicajangelinaevavimalb": ["Emy Hanna Moni", "Monica J", "Angelin Aniruth", "Eva Kumari", "Vimal B"],
    "kishoresmithamol": ["Kishorekumar D", "Smithamol P B"],
}

APPROVED_HISTORICAL_MEMBERS = {
    # Historical staff (in rota but not in current member designation list)
    "Buddula Rohith",
    "Divyalakshmi",
    "Emilia Mary Pushparaj",
    "Joseph A P",
    "Karthikpandian S",
    "Kaviya",
    "Kaviya Sree",
    "Joanna Emmanuel",
    "Manjunath",
    "Meeta G",
    "Nanthini S",
    "Prathima Roys",
    "Vineeth Indla",
    "Indla Joseph Vineeth",
    "Abin Iype",
    "Angelyn Veronica",
    "Andrea Cris",
    "Devi Balasubramanyam",
    "Dilfa Sharon",
    "Franklin Vedha Prabhu",
    "Sudi Cuty Mahlah",
    "Minu",
    "Narasimha Rao",
    "Pavithra",
    "Prabhakaran S",
    "Prerna Nayan",
    "Prashin L R P",
    "Rahavi Rajendran",
    "Rajesh Ravi",
    "Ranjitha K V",
    "Rohan Jacob Titus",
    "SADHANANDA",
    "Sakshi Harris",
    "Samzai Lungalang",
    "Samuel D C",
    "Shijimol G",
    "Sugashini",
    "Vignesh R",
    "Kaviarasan",
    "Jonathan Joseph",
    # New DM/PDF and batch members appearing in 2025-2026 rotas
    "Jerolin A",
    "Bharath Kumar",
    "Amrita Pramod",
    "Durai Henry",
    "Naveen Raj",
    "Geerthana M",
    "Ram Prakash R",
    "Mowli",
    "Samuel Cherwin Wesley",
    "Abhilash R N",
    "Jerome Kumar",
    "Sujatha Bhaskar",
    "Jagan",
}


@dataclass(frozen=True)
class CanonicalMember:
    person_id: str | None
    canonical_name: str
    call_level: str | None
    source: str


@dataclass(frozen=True)
class NameResolution:
    status: str
    canonical_name: str | None
    cleaned_name: str
    confidence: float
    reason: str


@dataclass(frozen=True)
class MatchedDuty:
    source_file: str
    sheet_name: str
    period: str
    duty_date: str
    weekday_label: str
    duty_label: str
    duty_type: str
    is_24hr: bool
    is_weekend: bool
    raw_person_name: str
    cleaned_person_name: str
    canonical_name: str
    match_reason: str
    confidence: float
    row_index: int
    column_label: str


@dataclass(frozen=True)
class SkippedName:
    source_kind: str
    source_file: str
    sheet_name: str
    period: str
    raw_person_name: str
    cleaned_person_name: str
    status: str
    reason: str
    row_index: int
    column_label: str
    duty_or_posting_label: str


@dataclass(frozen=True)
class MatchedPosting:
    source_file: str
    sheet_name: str
    period: str
    unit_label: str
    posting_label: str
    raw_person_name: str
    cleaned_person_name: str
    canonical_name: str
    match_reason: str
    confidence: float
    row_index: int
    column_label: str


@dataclass(frozen=True)
class AliasApplySummary:
    source_file: str
    rows_read: int
    aliases_created: int
    already_existing: int
    skipped_same_as_canonical: int
    skipped_unknown_person: int
    skipped_conflicts: int
    skipped_unaccepted_reason: int
    skipped_invalid_alias: int


@dataclass(frozen=True)
class HistoricalAnalysisImportSummary:
    duty_rows_read: int
    posting_rows_read: int
    people_created: int
    periods_created: int
    units_created: int
    duty_slots_created: int
    duty_assignments_created: int
    postings_created: int
    existing_duty_assignments: int
    existing_postings: int
    skipped_unknown_people: int
    skipped_unmapped_duties: int
    source: str


def compact_name(value: str) -> str:
    cleaned = clean_person_name(value)
    cleaned = re.sub(r"\b(dr|prof|mr|mrs|ms)\b\.?", " ", cleaned, flags=re.IGNORECASE)
    cleaned = re.sub(r"[^a-z0-9]+", "", cleaned.casefold())
    return cleaned


def tokenise_name(value: str) -> tuple[str, ...]:
    cleaned = clean_person_name(value)
    return tuple(re.findall(r"[a-z0-9]+", cleaned.casefold()))


def initials_signature(value: str) -> str:
    return "".join(token[0] for token in tokenise_name(value) if token)


def period_key(year: int, month: int) -> str:
    return f"{year:04d}-{month:02d}"


def parse_period(value: str) -> tuple[int, int]:
    year, month = value.split("-", maxsplit=1)
    return int(year), int(month)


def month_bounds(year: int, month: int) -> tuple[date, date]:
    return date(year, month, 1), date(year, month, monthrange(year, month)[1])


def unit_code(value: str) -> str:
    code = re.sub(r"[^A-Z0-9]+", "_", value.upper()).strip("_")
    return code[:50] or "UNKNOWN_UNIT"


def reference_month_key(period: str) -> str:
    year, month = period.split("-")
    labels = (
        "Jan",
        "Feb",
        "Mar",
        "Apr",
        "May",
        "Jun",
        "Jul",
        "Aug",
        "Sep",
        "Oct",
        "Nov",
        "Dec",
    )
    return f"{labels[int(month) - 1]}_{year}"


def source_duty_type_from_label(label: str) -> str | None:
    duty_type = classify_duty_label(label)
    if duty_type == "SCHELL_AND_FLOATING":
        return None
    return duty_type


def load_canonical_members_from_db() -> list[CanonicalMember]:
    if SessionLocal is None:
        return []
    try:
        with SessionLocal() as db:
            people = db.scalars(select(Person).order_by(Person.canonical_name)).all()
            return [
                CanonicalMember(
                    person_id=str(person.id),
                    canonical_name=person.canonical_name,
                    call_level=person.call_level,
                    source="database",
                )
                for person in people
            ]
    except Exception:
        return []


def load_reference_canonical_members(path: Path = DEFAULT_REFERENCE_HTML) -> list[CanonicalMember]:
    if not path.exists():
        return []
    text = path.read_text(encoding="utf-8", errors="ignore")
    person_stats_match = re.search(
        r"const\s+PERSON_STATS\s*=\s*(\{.*?\});\s*const\s+MONTH_STATS",
        text,
        re.DOTALL,
    )
    if person_stats_match is None:
        return []

    person_stats = json.loads(person_stats_match.group(1))
    return [
        CanonicalMember(
            person_id=None,
            canonical_name=name,
            call_level=None,
            source="reference_html",
        )
        for name in sorted(person_stats)
    ]


def load_alias_lookup_from_db() -> dict[str, str]:
    if SessionLocal is None:
        return {}
    try:
        from sqlalchemy.orm import selectinload

        with SessionLocal() as db:
            people = db.scalars(
                select(Person).options(selectinload(Person.aliases))
            ).all()
            aliases: dict[str, str] = {}
            for person in people:
                for alias in person.aliases:
                    key = compact_name(alias.alias)
                    if key:
                        aliases[key] = person.canonical_name
            return aliases
    except Exception:
        return {}


def load_canonical_members() -> list[CanonicalMember]:
    members = load_canonical_members_from_db()
    reference_members = load_reference_canonical_members()
    if members:
        merged = {compact_name(member.canonical_name): member for member in members}
        for member in reference_members:
            key = compact_name(member.canonical_name)
            if key and key not in merged:
                merged[key] = member
        for name in APPROVED_HISTORICAL_MEMBERS:
            key = compact_name(name)
            if key and key not in merged:
                merged[key] = CanonicalMember(None, name, None, "manual_alias_file")
        return sorted(merged.values(), key=lambda member: member.canonical_name.casefold())

    roster_members = extract_clean_roster_members(TRUSTED_ROSTER_PATH)
    trusted_members = [
        CanonicalMember(
            person_id=None,
            canonical_name=member.name,
            call_level=None,
            source="trusted_roster_file",
        )
        for member in roster_members
    ]
    merged = {compact_name(member.canonical_name): member for member in trusted_members}
    for member in reference_members:
        key = compact_name(member.canonical_name)
        if key and key not in merged:
            merged[key] = member
    for name in APPROVED_HISTORICAL_MEMBERS:
        key = compact_name(name)
        if key and key not in merged:
            merged[key] = CanonicalMember(None, name, None, "manual_alias_file")
    return sorted(merged.values(), key=lambda member: member.canonical_name.casefold())


class CanonicalNameResolver:
    def __init__(
        self,
        members: Iterable[CanonicalMember],
        alias_lookup: dict[str, str] | None = None,
    ) -> None:
        self.members = list(members)
        self.alias_lookup = alias_lookup or {}
        self.by_compact: dict[str, list[CanonicalMember]] = defaultdict(list)
        self.by_first_last: dict[tuple[str, str], list[CanonicalMember]] = defaultdict(list)
        self.by_first_token: dict[str, list[CanonicalMember]] = defaultdict(list)
        self.by_any_token: dict[str, list[CanonicalMember]] = defaultdict(list)
        self.by_first_last_initial: dict[tuple[str, str], list[CanonicalMember]] = defaultdict(list)

        for member in self.members:
            compact = compact_name(member.canonical_name)
            if compact:
                self.by_compact[compact].append(member)
            tokens = tokenise_name(member.canonical_name)
            if tokens:
                self.by_first_token[tokens[0]].append(member)
            for token in tokens:
                self.by_any_token[token].append(member)
            if len(tokens) >= 2:
                self.by_first_last[(tokens[0], tokens[-1])].append(member)
                self.by_first_last_initial[(tokens[0], tokens[-1][0])].append(member)

    def resolve(self, value: str) -> NameResolution:
        cleaned = clean_person_name(value)
        if not cleaned or not is_valid_person_name(cleaned):
            return NameResolution("invalid", None, cleaned, 0.0, "not_person_like")

        compact = compact_name(cleaned)
        alias_match = self.alias_lookup.get(compact)
        if alias_match is not None:
            if not self._saved_alias_is_ambiguous(cleaned, alias_match):
                return NameResolution("matched", alias_match, cleaned, 1.0, "saved_alias")

        exact = self._unique(self.by_compact.get(compact, []))
        if exact is not None:
            return NameResolution("matched", exact.canonical_name, cleaned, 1.0, "compact_exact")

        tokens = tokenise_name(cleaned)
        if len(tokens) == 1 and len(tokens[0]) >= 4:
            first_token = self._unique(self.by_first_token.get(tokens[0], []))
            if first_token is not None:
                return NameResolution(
                    "matched",
                    first_token.canonical_name,
                    cleaned,
                    0.93,
                    "unique_first_name",
                )

        token_variant = self._resolve_token_variant(tokens, cleaned)
        if token_variant is not None:
            return token_variant

        if len(tokens) >= 2:
            first_last = self._unique(self.by_first_last.get((tokens[0], tokens[-1]), []))
            if first_last is not None:
                return NameResolution("matched", first_last.canonical_name, cleaned, 0.97, "first_last")
            if len(tokens[-1]) == 1:
                first_last_initial = self._unique(
                    self.by_first_last_initial.get((tokens[0], tokens[-1]), [])
                )
                if first_last_initial is not None:
                    return NameResolution(
                        "matched",
                        first_last_initial.canonical_name,
                        cleaned,
                        0.95,
                        "first_name_last_initial",
                    )

        return NameResolution("unmatched", None, cleaned, 0.0, "no_canonical_member")

    def _resolve_token_variant(self, tokens: tuple[str, ...], cleaned: str) -> NameResolution | None:
        if not tokens:
            return None
        candidates: list[tuple[float, CanonicalMember, str]] = []
        for member in self.members:
            member_tokens = tokenise_name(member.canonical_name)
            score = self._ordered_token_variant_score(tokens, member_tokens)
            if score is not None:
                candidates.append((score, member, "ordered_token_variant"))

        if not candidates:
            return None

        candidates.sort(key=lambda item: item[0], reverse=True)
        best_score = candidates[0][0]
        tied = [
            candidate
            for score, candidate, _reason in candidates
            if abs(score - best_score) < 0.015
        ]
        unique_names = {candidate.canonical_name for candidate in tied}
        if len(unique_names) != 1:
            return NameResolution("ambiguous", None, cleaned, round(best_score, 3), "token_variant_tie")

        best_member = candidates[0][1]
        return NameResolution(
            "matched",
            best_member.canonical_name,
            cleaned,
            round(best_score, 3),
            candidates[0][2],
        )

    def _saved_alias_is_ambiguous(self, alias: str, canonical_name: str) -> bool:
        tokens = tokenise_name(alias)
        if len(tokens) != 1:
            return False

        token = tokens[0]
        if len(token) >= 4:
            first_token_match = self._unique(self.by_first_token.get(token, []))
            if first_token_match is not None:
                return first_token_match.canonical_name != canonical_name

        containing_names = {
            member.canonical_name
            for member in self.by_any_token.get(token, [])
        }
        return len(containing_names) > 1

    def _ordered_token_variant_score(
        self,
        query_tokens: tuple[str, ...],
        member_tokens: tuple[str, ...],
    ) -> float | None:
        if not query_tokens or not member_tokens:
            return None

        token_scores: list[float] = []
        search_from = 0
        for query_token in query_tokens:
            match_index = None
            match_score = 0.0
            for index in range(search_from, len(member_tokens)):
                score = self._token_match_score(query_token, member_tokens[index])
                if score > match_score:
                    match_index = index
                    match_score = score
            if match_index is None or match_score <= 0:
                return None
            token_scores.append(match_score)
            search_from = match_index + 1

        if len(query_tokens) == 1:
            if len(query_tokens[0]) < 3:
                return None
            if token_scores[0] < 0.88:
                return None
            return token_scores[0] - 0.01

        if min(token_scores) < 0.72:
            return None
        coverage_bonus = min(0.04, len(query_tokens) / max(len(member_tokens), 1) * 0.04)
        return sum(token_scores) / len(token_scores) + coverage_bonus

    @staticmethod
    def _token_match_score(query_token: str, member_token: str) -> float:
        if query_token == member_token:
            return 0.93
        if len(query_token) == 1 and member_token.startswith(query_token):
            return 0.78
        if len(query_token) >= 4 and member_token.startswith(query_token):
            return 0.90
        if len(query_token) >= 4 and member_token.endswith(query_token):
            return 0.89
        return 0.0

    @staticmethod
    def _unique(candidates: list[CanonicalMember]) -> CanonicalMember | None:
        if len(candidates) == 1:
            return candidates[0]
        return None


def is_24hr_duty(assignment: ParsedRotaAssignment) -> bool:
    return assignment.is_24hr or assignment.duty_type.endswith("_24HR") or assignment.duty_type in TWENTY_FOUR_HOUR_TYPES


def is_main_24hr_duty(duty_type: str) -> bool:
    return duty_type in MAIN_24HR_KEYS


def is_weekend(duty_date: date) -> bool:
    return duty_date.weekday() >= 5


def duty_level_rank(duty_type: str, duty_label: str) -> int | None:
    label = re.sub(r"\b20\d{2}\b", " ", duty_label.casefold())
    if "_4TH" in duty_type or "4th" in label or "senior" in label:
        return 4
    if "_3RD" in duty_type or "3rd" in label:
        return 3
    if "_2ND" in duty_type or "2nd" in label or "caesar" in label or "cesar" in label:
        return 2
    if "_1ST" in duty_type or "1st" in label:
        return 1
    return None


def period_after(period: str, threshold: str) -> bool:
    return period >= threshold


def manual_name_resolution(
    assignment: ParsedRotaAssignment | ParsedUnitPosting,
    period: str,
) -> NameResolution | None:
    cleaned = clean_person_name(assignment.person_name)
    key = compact_name(cleaned)
    exact = MANUAL_ALIAS_OVERRIDES.get(key)
    if exact is not None:
        return NameResolution("matched", exact, cleaned, 1.0, "manual_alias")

    if not isinstance(assignment, ParsedRotaAssignment):
        return None

    level = duty_level_rank(assignment.duty_type, assignment.duty_label)
    lowered = cleaned.casefold()

    if key in {"rohan", "rohanc", "rohanchacko"}:
        if level == 3 and not period_after(period, "2026-04"):
            return NameResolution("matched", "Rohan Jacob Titus", cleaned, 0.99, "manual_context")
        return NameResolution("matched", "Rohan Chacko Jacob", cleaned, 0.99, "manual_context")
    if key in {"rohanjt", "rohanjacobtitus", "rohantitus", "rohanj"}:
        return NameResolution("matched", "Rohan Jacob Titus", cleaned, 1.0, "manual_alias")

    if key in {"naveen", "naveenk", "koppakanaveen"}:
        if level == 4:
            return NameResolution("matched", "Suda Naveen", cleaned, 0.99, "manual_context")
        return NameResolution("matched", "Koppaka Naveen Kumar", cleaned, 0.99, "manual_context")
    if key in {"naveens", "sudanaveen", "sudanaveenkumar"}:
        return NameResolution("matched", "Suda Naveen", cleaned, 1.0, "manual_alias")

    if key in {"preethia", "preethy", "preethya"}:
        return NameResolution("matched", "Preethi A", cleaned, 1.0, "manual_alias")
    if key == "preethi":
        if level is not None and level >= 3:
            return NameResolution("matched", "Preethi Kuryan", cleaned, 0.99, "manual_context")
        return NameResolution("matched", "Preethi A", cleaned, 0.99, "manual_context")

    if key == "daniel":
        if level == 4:
            return NameResolution("matched", "Pradeep Daniel", cleaned, 0.99, "manual_context")
        if level == 1 and period_after(period, "2026-03"):
            return NameResolution("matched", "Joel Daniel", cleaned, 0.99, "manual_context")
        return NameResolution("matched", "Daniel Jonathan Roy", cleaned, 0.99, "manual_context")

    if key == "joel":
        if level is not None and level >= 3:
            return NameResolution("matched", "Joel V Peter", cleaned, 0.99, "manual_context")
        if level == 1 and period_after(period, "2026-03"):
            return NameResolution("matched", "Joel Daniel", cleaned, 0.99, "manual_context")
        return NameResolution("matched", "Joel Koil Raj", cleaned, 0.99, "manual_context")

    if key == "david":
        if level == 1:
            return NameResolution("matched", "David Samson Rontala", cleaned, 0.99, "manual_context")
        if level == 2:
            return NameResolution("matched", "Karumuru David Raj", cleaned, 0.99, "manual_context")
        return NameResolution("ambiguous", None, cleaned, 0.0, "manual_shared_short_name")

    if key == "jeenu":
        if assignment.duty_type == "CART":
            return NameResolution("matched", "Jeenu Ann Jose", cleaned, 0.99, "manual_context")
        if level in {2, 3}:
            return NameResolution("matched", "Jeenu Ann Jose", cleaned, 0.99, "manual_context")
        if level == 4:
            return NameResolution("matched", "Jeenu D", cleaned, 0.99, "manual_context")
        return NameResolution("ambiguous", None, cleaned, 0.0, "manual_shared_short_name")

    if key == "riya":
        if level == 3:
            return NameResolution("matched", "Riya Lal", cleaned, 0.99, "manual_context")
        return NameResolution("matched", "Riya Sarah Abraham", cleaned, 0.99, "manual_context")

    if key in {"priya", "priyadharshini", "priyadarshini"}:
        if level == 1:
            return NameResolution("matched", "Priyadharshini S", cleaned, 0.99, "manual_context")
        if level == 3:
            return NameResolution("matched", "Priyadarshini Kalahasthi", cleaned, 0.99, "manual_context")
        if level == 2:
            return NameResolution("matched", "Priyadharshini S", cleaned, 0.99, "manual_context")
        return NameResolution("ambiguous", None, cleaned, 0.0, "manual_shared_short_name")

    if key == "angeline":
        label = assignment.duty_label.casefold()
        if level == 4 or "senior" in label:
            return NameResolution("matched", "Angeline Mary Abraham", cleaned, 0.99, "manual_context")
        if assignment.duty_type == "PAC" or level in {1, 2, 3}:
            return NameResolution("matched", "Angelin Aniruth", cleaned, 0.99, "manual_context")
        return NameResolution("ambiguous", None, cleaned, 0.0, "manual_shared_short_name")

    if key == "anisha":
        if level == 2:
            return NameResolution("matched", "Anisha Joy", cleaned, 0.99, "manual_context")
        return NameResolution("ambiguous", None, cleaned, 0.0, "manual_shared_short_name")

    if key == "christina" and period == "2025-03":
        if assignment.column_index in {7, 15}:
            return NameResolution("matched", "Christina Thomas", cleaned, 0.95, "manual_month_split")
        return NameResolution("matched", "Christina Reshma R", cleaned, 0.95, "manual_month_split")

    if key == "jonathan":
        if level == 3:
            return NameResolution("matched", "Jonathan Samuel B", cleaned, 0.99, "manual_context")
        return NameResolution("ambiguous", None, cleaned, 0.0, "manual_shared_short_name")

    if key == "sharon":
        if level == 4:
            return NameResolution("matched", "Sharon Kavya Chandana P", cleaned, 0.99, "manual_context")
        if level in {2, 3}:
            return NameResolution("matched", "Sharon J Ebenezer", cleaned, 0.99, "manual_context")
        return NameResolution("ambiguous", None, cleaned, 0.0, "manual_shared_short_name")

    if key == "sam":
        if level == 4:
            return NameResolution("matched", "Samuel D C", cleaned, 0.99, "manual_context")
        if level in {1, 2}:
            return NameResolution("matched", "Sam Charles D", cleaned, 0.99, "manual_context")
        return NameResolution("ambiguous", None, cleaned, 0.0, "manual_shared_short_name")

    if lowered in {"sam c", "sam chandran", "samuel c", "samuel david"}:
        return NameResolution("matched", "Samuel D C", cleaned, 1.0, "manual_alias")

    return None


def warning_to_dict(warning: ParseWarning) -> dict[str, object]:
    return {
        "source_file": str(warning.source_file),
        "sheet_name": warning.sheet_name,
        "row_index": warning.row_index,
        "column_index": warning.column_index,
        "code": warning.code,
        "message": warning.message,
    }


def scan_rota_file(path: Path, resolver: CanonicalNameResolver) -> tuple[list[MatchedDuty], list[SkippedName], list[dict[str, object]], tuple[int, int]]:
    parsed = parse_rota_workbook(path)
    matched: list[MatchedDuty] = []
    skipped: list[SkippedName] = []
    warnings = [warning_to_dict(warning) for warning in parsed.warnings]
    period = period_key(parsed.month.year, parsed.month.month)

    for assignment in parsed.assignments:
        # Check for multi-person cell first
        cleaned_for_split = clean_person_name(assignment.person_name)
        split_key = compact_name(cleaned_for_split)
        split_names = MULTI_PERSON_SPLITS.get(split_key)
        if split_names is None:
            # Try a few normalised variants for slash-separated names
            for sep in ["/", ",", " and ", " & ", " - "]:
                if sep in assignment.person_name:
                    parts = [p.strip() for p in assignment.person_name.split(sep) if p.strip()]
                    joined_key = compact_name("".join(parts))
                    split_names = MULTI_PERSON_SPLITS.get(joined_key)
                    if split_names:
                        break

        if split_names:
            for canon in split_names:
                matched.append(
                    MatchedDuty(
                        source_file=path.name,
                        sheet_name=assignment.sheet_name,
                        period=period,
                        duty_date=assignment.duty_date.isoformat(),
                        weekday_label=assignment.weekday_label,
                        duty_label=assignment.duty_label,
                        duty_type=assignment.duty_type,
                        is_24hr=is_24hr_duty(assignment),
                        is_weekend=is_weekend(assignment.duty_date),
                        raw_person_name=assignment.raw_person_name,
                        cleaned_person_name=cleaned_for_split,
                        canonical_name=canon,
                        match_reason="multi_person_split",
                        confidence=0.95,
                        row_index=assignment.row_index,
                        column_label=assignment.column_label,
                    )
                )
            continue

        resolution = manual_name_resolution(assignment, period) or resolver.resolve(assignment.person_name)
        if resolution.status != "matched" or resolution.canonical_name is None:
            skipped.append(
                SkippedName(
                    source_kind="rota",
                    source_file=path.name,
                    sheet_name=assignment.sheet_name,
                    period=period,
                    raw_person_name=assignment.raw_person_name,
                    cleaned_person_name=resolution.cleaned_name,
                    status=resolution.status,
                    reason=resolution.reason,
                    row_index=assignment.row_index,
                    column_label=assignment.column_label,
                    duty_or_posting_label=assignment.duty_label,
                )
            )
            continue

        matched.append(
            MatchedDuty(
                source_file=path.name,
                sheet_name=assignment.sheet_name,
                period=period,
                duty_date=assignment.duty_date.isoformat(),
                weekday_label=assignment.weekday_label,
                duty_label=assignment.duty_label,
                duty_type=assignment.duty_type,
                is_24hr=is_24hr_duty(assignment),
                is_weekend=is_weekend(assignment.duty_date),
                raw_person_name=assignment.raw_person_name,
                cleaned_person_name=resolution.cleaned_name,
                canonical_name=resolution.canonical_name,
                match_reason=resolution.reason,
                confidence=resolution.confidence,
                row_index=assignment.row_index,
                column_label=assignment.column_label,
            )
        )

    return matched, skipped, warnings, (parsed.month.year, parsed.month.month)


def scan_unitwise_file(path: Path, resolver: CanonicalNameResolver) -> tuple[list[MatchedPosting], list[SkippedName], list[dict[str, object]], tuple[int, int]]:
    parsed = parse_unitwise_workbook(path)
    matched: list[MatchedPosting] = []
    skipped: list[SkippedName] = []
    warnings = [warning_to_dict(warning) for warning in parsed.warnings]
    period = period_key(parsed.month.year, parsed.month.month)

    for posting in parsed.postings:
        resolution = manual_name_resolution(posting, period) or resolver.resolve(posting.person_name)
        if resolution.status != "matched" or resolution.canonical_name is None:
            skipped.append(
                SkippedName(
                    source_kind="unitwise",
                    source_file=path.name,
                    sheet_name=posting.sheet_name,
                    period=period,
                    raw_person_name=posting.raw_person_name,
                    cleaned_person_name=resolution.cleaned_name,
                    status=resolution.status,
                    reason=resolution.reason,
                    row_index=posting.row_index,
                    column_label=posting.column_label,
                    duty_or_posting_label=posting.posting_label,
                )
            )
            continue

        matched.append(
            MatchedPosting(
                source_file=path.name,
                sheet_name=posting.sheet_name,
                period=period,
                unit_label=posting.unit_label,
                posting_label=posting.posting_label,
                raw_person_name=posting.raw_person_name,
                cleaned_person_name=resolution.cleaned_name,
                canonical_name=resolution.canonical_name,
                match_reason=resolution.reason,
                confidence=resolution.confidence,
                row_index=posting.row_index,
                column_label=posting.column_label,
            )
        )

    return matched, skipped, warnings, (parsed.month.year, parsed.month.month)


def write_csv(path: Path, rows: Iterable[object]) -> None:
    materialized = [asdict(row) if hasattr(row, "__dataclass_fields__") else dict(row) for row in rows]
    if not materialized:
        path.write_text("", encoding="utf-8")
        return

    with path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=list(materialized[0].keys()))
        writer.writeheader()
        writer.writerows(materialized)


def summarize_reference_html(path: Path) -> dict[str, object]:
    if not path.exists():
        return {"available": False}
    text = path.read_text(encoding="utf-8", errors="ignore")
    nav_labels = re.findall(r"<button class=\"nav-tab\"[^>]*>([^<]+)</button>", text)
    month_stats_match = re.search(r"const\s+MONTH_STATS\s*=\s*(\{.*?\});\s*const\s+MONTHS", text, re.DOTALL)
    person_stats_match = re.search(r"const\s+PERSON_STATS\s*=\s*(\{.*?\});\s*const\s+MONTH_STATS", text, re.DOTALL)
    month_stats: dict[str, dict[str, object]] = {}
    person_stats: dict[str, dict[str, object]] = {}
    if month_stats_match:
        month_stats = json.loads(month_stats_match.group(1))
    if person_stats_match:
        person_stats = json.loads(person_stats_match.group(1))

    total_24hr = sum(int(month.get("total_24hr", 0)) for month in month_stats.values())
    total_weekend = sum(int(month.get("weekend_24hr", 0)) for month in month_stats.values())
    return {
        "available": True,
        "tabs": sorted(set(nav_labels)),
        "months": len(month_stats) or None,
        "personnel": len(person_stats) or None,
        "twenty_four_hour_duties": total_24hr or None,
        "weekend_duties": total_weekend or None,
        "month_stats": month_stats,
    }


def build_markdown_report(summary: dict[str, object], output_dir: Path) -> str:
    top_skipped = summary["top_skipped_names"]
    lines = [
        "# Historical Analysis Dry Run",
        "",
        f"Generated: {datetime.now().isoformat(timespec='seconds')}",
        "",
        "## Scope",
        "",
        f"- Canonical members loaded: {summary['canonical_members']}",
        f"- Canonical source: {summary['canonical_source']}",
        f"- Rota files scanned: {summary['rota_files']}",
        f"- Unitwise files scanned: {summary['unitwise_files']}",
        f"- Periods detected: {', '.join(summary['periods_detected'])}",
        "",
        "## Rota Matching",
        "",
        f"- Raw rota assignments parsed: {summary['raw_rota_assignments']}",
        f"- Matched rota assignments: {summary['matched_rota_assignments']}",
        f"- Skipped rota assignments: {summary['skipped_rota_assignments']}",
        f"- Unique matched duty members: {summary['unique_duty_members']}",
        f"- 24-hour duration matched assignments: {summary['matched_24hr_duration_assignments']}",
        f"- Main 24-hour matched assignments: {summary['matched_main_24hr_assignments']}",
        f"- Weekend main 24-hour matched assignments: {summary['matched_weekend_main_24hr_assignments']}",
        "",
        "## Unitwise Matching",
        "",
        f"- Raw unitwise postings parsed: {summary['raw_unitwise_postings']}",
        f"- Matched unitwise postings: {summary['matched_unitwise_postings']}",
        f"- Skipped unitwise postings: {summary['skipped_unitwise_postings']}",
        f"- Unique matched posting members: {summary['unique_posting_members']}",
        "",
        "## Data Quality",
        "",
        f"- Parser warnings: {summary['parser_warnings']}",
        f"- Ambiguous skipped names: {summary['ambiguous_names']}",
        f"- Invalid skipped names: {summary['invalid_names']}",
        f"- Unmatched skipped names: {summary['unmatched_names']}",
        f"- Paired duty gaps: {summary['paired_duty_gaps']}",
        "",
        "## Top Skipped Names",
        "",
    ]
    if top_skipped:
        for name, count in top_skipped:
            lines.append(f"- {name or '[blank]'}: {count}")
    else:
        lines.append("- None")

    lines.extend(
        [
            "",
            "## Reference HTML Snapshot",
            "",
            f"- Reference available: {summary['reference_html']['available']}",
            f"- Reference months: {summary['reference_html'].get('months')}",
            f"- Reference personnel: {summary['reference_html'].get('personnel')}",
            f"- Reference 24-hour duties: {summary['reference_html'].get('twenty_four_hour_duties')}",
            f"- Reference weekend duties: {summary['reference_html'].get('weekend_duties')}",
            "",
            "## Files Written",
            "",
            f"- `{output_dir / 'summary.json'}`",
            f"- `{output_dir / 'matched_duties.csv'}`",
            f"- `{output_dir / 'matched_postings.csv'}`",
            f"- `{output_dir / 'skipped_names.csv'}`",
            f"- `{output_dir / 'parser_warnings.csv'}`",
            f"- `{output_dir / 'monthly_tallies.csv'}`",
            f"- `{output_dir / 'person_tallies.csv'}`",
            f"- `{output_dir / 'reference_month_comparison.csv'}`",
            f"- `{output_dir / 'paired_duty_checks.csv'}`",
            f"- `{output_dir / 'alias_suggestions.csv'}`",
            "",
            "This is a dry run only. It does not write to the application database.",
            "",
        ]
    )
    return "\n".join(lines)


def run_dry_run(
    historical_dir: Path = DEFAULT_HISTORICAL_DIR,
    output_dir: Path = DEFAULT_OUTPUT_DIR,
    reference_html: Path = DEFAULT_REFERENCE_HTML,
) -> dict[str, object]:
    members = load_canonical_members()
    resolver = CanonicalNameResolver(members, load_alias_lookup_from_db())

    rota_files = sorted(path for path in historical_dir.glob("*.xlsx") if path.is_file())
    unitwise_files = sorted(path for path in (historical_dir / "unitwise").glob("*.xlsx") if path.is_file())

    matched_duties: list[MatchedDuty] = []
    matched_postings: list[MatchedPosting] = []
    skipped_names: list[SkippedName] = []
    parser_warnings: list[dict[str, object]] = []
    source_duty_counter: dict[tuple[str, str], Counter[str]] = defaultdict(Counter)
    periods: set[str] = set()
    raw_rota_assignments = 0
    raw_unitwise_postings = 0

    for path in rota_files:
        matched, skipped, warnings, month = scan_rota_file(path, resolver)
        matched_duties.extend(matched)
        skipped_names.extend(skipped)
        parser_warnings.extend(warnings)
        period = period_key(*month)
        for duty in matched:
            source_duty_counter[(period, duty.duty_type)]["matched"] += 1
        for skipped_name in skipped:
            duty_type = source_duty_type_from_label(skipped_name.duty_or_posting_label)
            if duty_type is not None:
                source_duty_counter[(period, duty_type)]["skipped"] += 1
        raw_rota_assignments += len(matched) + len(skipped)
        periods.add(period)

    for path in unitwise_files:
        matched, skipped, warnings, month = scan_unitwise_file(path, resolver)
        matched_postings.extend(matched)
        skipped_names.extend(skipped)
        parser_warnings.extend(warnings)
        raw_unitwise_postings += len(matched) + len(skipped)
        periods.add(period_key(*month))

    monthly_counter: dict[tuple[str, str], Counter[str]] = defaultdict(Counter)
    person_counter: dict[str, Counter[str]] = defaultdict(Counter)
    for duty in matched_duties:
        monthly_counter[(duty.period, duty.duty_type)]["assignments"] += 1
        person_counter[duty.canonical_name]["total_assignments"] += 1
        if duty.is_24hr:
            monthly_counter[(duty.period, duty.duty_type)]["duration_24hr"] += 1
        if is_main_24hr_duty(duty.duty_type):
            monthly_counter[(duty.period, duty.duty_type)]["twenty_four_hour"] += 1
            person_counter[duty.canonical_name]["twenty_four_hour"] += 1
        if duty.is_weekend and duty.is_24hr:
            monthly_counter[(duty.period, duty.duty_type)]["weekend_duration_24hr"] += 1
        if duty.is_weekend and is_main_24hr_duty(duty.duty_type):
            monthly_counter[(duty.period, duty.duty_type)]["weekend_twenty_four_hour"] += 1
            person_counter[duty.canonical_name]["weekend_twenty_four_hour"] += 1
        person_counter[duty.canonical_name][f"duty_type:{duty.duty_type}"] += 1

    monthly_rows = [
        {
            "period": period,
            "duty_type": duty_type,
            "assignments": counts["assignments"],
            "twenty_four_hour": counts["twenty_four_hour"],
            "weekend_twenty_four_hour": counts["weekend_twenty_four_hour"],
        }
        for (period, duty_type), counts in sorted(monthly_counter.items())
    ]
    person_rows = [
        {
            "canonical_name": name,
            "total_assignments": counts["total_assignments"],
            "twenty_four_hour": counts["twenty_four_hour"],
            "weekend_twenty_four_hour": counts["weekend_twenty_four_hour"],
        }
        for name, counts in sorted(
            person_counter.items(),
            key=lambda item: (-item[1]["twenty_four_hour"], item[0].casefold()),
        )
    ]

    alias_counter: Counter[tuple[str, str, str]] = Counter()
    for duty in matched_duties:
        if compact_name(duty.cleaned_person_name) != compact_name(duty.canonical_name):
            alias_counter[
                (duty.cleaned_person_name, duty.canonical_name, duty.match_reason)
            ] += 1
    for posting in matched_postings:
        if compact_name(posting.cleaned_person_name) != compact_name(posting.canonical_name):
            alias_counter[
                (posting.cleaned_person_name, posting.canonical_name, posting.match_reason)
            ] += 1

    alias_rows = [
        {
            "variant_name": variant,
            "canonical_name": canonical,
            "match_reason": reason,
            "occurrences": count,
        }
        for (variant, canonical, reason), count in sorted(
            alias_counter.items(),
            key=lambda item: (-item[1], item[0][1].casefold(), item[0][0].casefold()),
        )
    ]

    reference_html_summary = summarize_reference_html(reference_html)
    reference_month_stats = reference_html_summary.get("month_stats") or {}
    monthly_totals: dict[str, Counter[str]] = defaultdict(Counter)
    for duty in matched_duties:
        monthly_totals[duty.period]["assignments"] += 1
        if duty.is_24hr:
            monthly_totals[duty.period]["duration_24hr"] += 1
        if is_main_24hr_duty(duty.duty_type):
            monthly_totals[duty.period]["twenty_four_hour"] += 1
        if duty.is_weekend and is_main_24hr_duty(duty.duty_type):
            monthly_totals[duty.period]["weekend_twenty_four_hour"] += 1

    reference_comparison_rows = []
    for period in sorted(periods):
        ref_key = reference_month_key(period)
        reference_month = (
            reference_month_stats.get(ref_key, {})
            if isinstance(reference_month_stats, dict)
            else {}
        )
        dry_total_24hr = monthly_totals[period]["twenty_four_hour"]
        dry_weekend_24hr = monthly_totals[period]["weekend_twenty_four_hour"]
        ref_total_24hr = int(reference_month.get("total_24hr", 0))
        ref_weekend_24hr = int(reference_month.get("weekend_24hr", 0))
        reference_comparison_rows.append(
            {
                "period": period,
                "reference_key": ref_key,
                "dry_run_24hr": dry_total_24hr,
                "reference_24hr": ref_total_24hr,
                "delta_24hr": dry_total_24hr - ref_total_24hr,
                "dry_run_weekend_24hr": dry_weekend_24hr,
                "reference_weekend_24hr": ref_weekend_24hr,
                "delta_weekend_24hr": dry_weekend_24hr - ref_weekend_24hr,
            }
        )

    paired_duty_rows = []
    paired_definitions = [
        ("caesar", "CAESAR_A_12HR", "CAESAR_B_24HR"),
    ]
    for period in sorted(periods):
        ref_key = reference_month_key(period)
        reference_month = (
            reference_month_stats.get(ref_key, {})
            if isinstance(reference_month_stats, dict)
            else {}
        )
        reference_counts = reference_month.get("duty_type_counts", {})
        if not isinstance(reference_counts, dict):
            reference_counts = {}
        for pair_name, left_key, right_key in paired_definitions:
            left_counts = source_duty_counter[(period, left_key)]
            right_counts = source_duty_counter[(period, right_key)]
            left_raw = left_counts["matched"] + left_counts["skipped"]
            right_raw = right_counts["matched"] + right_counts["skipped"]
            paired_duty_rows.append(
                {
                    "period": period,
                    "pair": pair_name,
                    "left_duty_type": left_key,
                    "right_duty_type": right_key,
                    "left_raw": left_raw,
                    "right_raw": right_raw,
                    "raw_delta": left_raw - right_raw,
                    "left_matched": left_counts["matched"],
                    "right_matched": right_counts["matched"],
                    "matched_delta": left_counts["matched"] - right_counts["matched"],
                    "left_skipped": left_counts["skipped"],
                    "right_skipped": right_counts["skipped"],
                    "reference_left": int(reference_counts.get(left_key, 0)),
                    "reference_right": int(reference_counts.get(right_key, 0)),
                    "reference_delta": int(reference_counts.get(left_key, 0))
                    - int(reference_counts.get(right_key, 0)),
                    "status": "balanced" if left_raw == right_raw else "source_or_rule_mismatch",
                }
            )

    skipped_counter = Counter(skipped.cleaned_person_name for skipped in skipped_names)
    paired_duty_gaps = [row for row in paired_duty_rows if row["status"] != "balanced"]
    summary: dict[str, object] = {
        "canonical_members": len(members),
        "canonical_source": "+".join(sorted({member.source for member in members})) if members else "none",
        "rota_files": len(rota_files),
        "unitwise_files": len(unitwise_files),
        "periods_detected": sorted(periods),
        "raw_rota_assignments": raw_rota_assignments,
        "matched_rota_assignments": len(matched_duties),
        "skipped_rota_assignments": sum(1 for item in skipped_names if item.source_kind == "rota"),
        "unique_duty_members": len({duty.canonical_name for duty in matched_duties}),
        "matched_24hr_duration_assignments": sum(1 for duty in matched_duties if duty.is_24hr),
        "matched_main_24hr_assignments": sum(1 for duty in matched_duties if is_main_24hr_duty(duty.duty_type)),
        "matched_weekend_main_24hr_assignments": sum(
            1 for duty in matched_duties if is_main_24hr_duty(duty.duty_type) and duty.is_weekend
        ),
        "raw_unitwise_postings": raw_unitwise_postings,
        "matched_unitwise_postings": len(matched_postings),
        "skipped_unitwise_postings": sum(1 for item in skipped_names if item.source_kind == "unitwise"),
        "unique_posting_members": len({posting.canonical_name for posting in matched_postings}),
        "parser_warnings": len(parser_warnings),
        "ambiguous_names": sum(1 for item in skipped_names if item.status == "ambiguous"),
        "invalid_names": sum(1 for item in skipped_names if item.status == "invalid"),
        "unmatched_names": sum(1 for item in skipped_names if item.status == "unmatched"),
        "paired_duty_gaps": len(paired_duty_gaps),
        "paired_duty_gap_examples": paired_duty_gaps[:25],
        "top_skipped_names": skipped_counter.most_common(25),
        "reference_html": {
            key: value
            for key, value in reference_html_summary.items()
            if key != "month_stats"
        },
    }

    output_dir.mkdir(parents=True, exist_ok=True)
    write_csv(output_dir / "matched_duties.csv", matched_duties)
    write_csv(output_dir / "matched_postings.csv", matched_postings)
    write_csv(output_dir / "skipped_names.csv", skipped_names)
    write_csv(output_dir / "parser_warnings.csv", parser_warnings)
    write_csv(output_dir / "monthly_tallies.csv", monthly_rows)
    write_csv(output_dir / "person_tallies.csv", person_rows)
    write_csv(output_dir / "reference_month_comparison.csv", reference_comparison_rows)
    write_csv(output_dir / "paired_duty_checks.csv", paired_duty_rows)
    write_csv(output_dir / "alias_suggestions.csv", alias_rows)
    (output_dir / "summary.json").write_text(
        json.dumps(summary, indent=2, default=str),
        encoding="utf-8",
    )
    (output_dir / "README.md").write_text(
        build_markdown_report(summary, output_dir),
        encoding="utf-8",
    )
    return summary


def apply_alias_suggestions(path: Path = DEFAULT_ALIAS_SUGGESTIONS) -> AliasApplySummary:
    if SessionLocal is None:
        raise RuntimeError("Database session is not available.")
    if not path.exists():
        raise FileNotFoundError(path)

    rows_read = 0
    aliases_created = 0
    already_existing = 0
    skipped_same_as_canonical = 0
    skipped_unknown_person = 0
    skipped_conflicts = 0
    skipped_unaccepted_reason = 0
    skipped_invalid_alias = 0

    with SessionLocal() as db:
        people = db.scalars(select(Person).order_by(Person.canonical_name)).all()
        people_by_name = {person.canonical_name: person for person in people}
        canonical_keys = {
            compact_name(person.canonical_name): person.canonical_name
            for person in people
            if compact_name(person.canonical_name)
        }

        with path.open(newline="", encoding="utf-8") as handle:
            reader = csv.DictReader(handle)
            for row in reader:
                rows_read += 1
                reason = (row.get("match_reason") or "").strip()
                if reason not in ACCEPTED_ALIAS_REASONS:
                    skipped_unaccepted_reason += 1
                    continue

                raw_alias = (row.get("variant_name") or "").strip()
                canonical_name = (row.get("canonical_name") or "").strip()
                person = people_by_name.get(canonical_name)
                if person is None:
                    skipped_unknown_person += 1
                    continue

                alias = clean_person_name(raw_alias)
                if not alias or not is_valid_person_name(alias):
                    skipped_invalid_alias += 1
                    continue
                if compact_name(alias) == compact_name(canonical_name):
                    skipped_same_as_canonical += 1
                    continue

                alias_key = compact_name(alias)
                canonical_collision = canonical_keys.get(alias_key)
                if canonical_collision is not None and canonical_collision != canonical_name:
                    skipped_conflicts += 1
                    continue

                existing = db.scalar(select(PersonAlias).where(PersonAlias.alias == alias))
                if existing is not None:
                    if existing.person_id == person.id:
                        already_existing += 1
                    else:
                        skipped_conflicts += 1
                    continue

                db.add(
                    PersonAlias(
                        person=person,
                        alias=alias,
                        source="historical_analysis_variant",
                    )
                )
                aliases_created += 1

        db.commit()

    return AliasApplySummary(
        source_file=str(path),
        rows_read=rows_read,
        aliases_created=aliases_created,
        already_existing=already_existing,
        skipped_same_as_canonical=skipped_same_as_canonical,
        skipped_unknown_person=skipped_unknown_person,
        skipped_conflicts=skipped_conflicts,
        skipped_unaccepted_reason=skipped_unaccepted_reason,
        skipped_invalid_alias=skipped_invalid_alias,
    )


def get_or_create_analysis_period(db, year: int, month: int, counters: Counter[str]) -> RotaPeriod:
    name = f"{year:04d}-{month:02d}"
    period = db.scalar(select(RotaPeriod).where(RotaPeriod.name == name))
    if period is not None:
        if period.status != "historical":
            period.status = "historical"
        return period

    starts_on, ends_on = month_bounds(year, month)
    period = RotaPeriod(name=name, starts_on=starts_on, ends_on=ends_on, status="historical")
    db.add(period)
    db.flush()
    counters["periods_created"] += 1
    return period


def get_or_create_unit(db, label: str, counters: Counter[str]) -> Unit:
    code = unit_code(label)
    unit = db.scalar(select(Unit).where(Unit.code == code))
    if unit is not None:
        return unit

    unit = Unit(code=code, name=label, notes=f"Historical unitwise label: {label}")
    db.add(unit)
    db.flush()
    counters["units_created"] += 1
    return unit


def get_or_create_historical_person(db, name: str, people: dict[str, Person], counters: Counter[str]) -> Person:
    person = people.get(name)
    if person is not None:
        return person

    person = Person(canonical_name=name, active_status="historical")
    db.add(person)
    db.flush()
    people[name] = person
    counters["people_created"] += 1
    return person


def import_matched_history(
    matched_duties_path: Path = DEFAULT_MATCHED_DUTIES,
    matched_postings_path: Path = DEFAULT_MATCHED_POSTINGS,
) -> HistoricalAnalysisImportSummary:
    if SessionLocal is None:
        raise RuntimeError("Database session is not available.")
    if not matched_duties_path.exists():
        raise FileNotFoundError(matched_duties_path)
    if not matched_postings_path.exists():
        raise FileNotFoundError(matched_postings_path)

    counters: Counter[str] = Counter()
    with SessionLocal() as db:
        people = {
            person.canonical_name: person
            for person in db.scalars(select(Person).order_by(Person.canonical_name)).all()
        }

        with matched_duties_path.open(newline="", encoding="utf-8") as handle:
            for row in csv.DictReader(handle):
                counters["duty_rows_read"] += 1
                if row["duty_type"] == "UNMAPPED":
                    counters["skipped_unmapped_duties"] += 1
                    continue
                person = get_or_create_historical_person(
                    db,
                    row["canonical_name"],
                    people,
                    counters,
                )

                year, month = parse_period(row["period"])
                period = get_or_create_analysis_period(db, year, month, counters)
                duty_date = date.fromisoformat(row["duty_date"])
                starts_at = datetime.combine(duty_date, datetime.min.time()).replace(hour=8)
                is_24hr = row["is_24hr"].casefold() == "true"
                duration_hours = 24 if is_24hr else 12
                slot = db.scalar(
                    select(DutySlot).where(
                        DutySlot.rota_period_id == period.id,
                        DutySlot.duty_date == duty_date,
                        DutySlot.duty_type == row["duty_type"],
                        DutySlot.slot_label == row["duty_label"],
                    )
                )
                if slot is None:
                    from datetime import timedelta

                    slot = DutySlot(
                        rota_period=period,
                        duty_date=duty_date,
                        duty_type=row["duty_type"],
                        slot_label=row["duty_label"],
                        starts_at=starts_at,
                        ends_at=starts_at + timedelta(hours=duration_hours),
                        is_24hr=is_24hr,
                        source="historical_analysis_import",
                        notes=(
                            f"{row['source_file']} {row['sheet_name']} "
                            f"{row['column_label']}{row['row_index']}"
                        ),
                    )
                    db.add(slot)
                    db.flush()
                    counters["duty_slots_created"] += 1

                existing = db.scalar(
                    select(DutyAssignment).where(
                        DutyAssignment.duty_slot_id == slot.id,
                        DutyAssignment.person_id == person.id,
                    )
                )
                if existing is not None:
                    counters["existing_duty_assignments"] += 1
                    continue

                db.add(
                    DutyAssignment(
                        duty_slot=slot,
                        person=person,
                        source="historical_analysis_import",
                    )
                )
                counters["duty_assignments_created"] += 1

        with matched_postings_path.open(newline="", encoding="utf-8") as handle:
            for row in csv.DictReader(handle):
                counters["posting_rows_read"] += 1
                person = get_or_create_historical_person(
                    db,
                    row["canonical_name"],
                    people,
                    counters,
                )

                year, month = parse_period(row["period"])
                starts_on, ends_on = month_bounds(year, month)
                unit = get_or_create_unit(db, row["unit_label"], counters)
                posting_type = row["posting_label"].upper().replace(" ", "_")
                existing = db.scalar(
                    select(PersonPosting).where(
                        PersonPosting.person_id == person.id,
                        PersonPosting.unit_id == unit.id,
                        PersonPosting.posting_type == posting_type,
                        PersonPosting.starts_on == starts_on,
                    )
                )
                if existing is not None:
                    counters["existing_postings"] += 1
                    continue

                db.add(
                    PersonPosting(
                        person=person,
                        unit=unit,
                        posting_type=posting_type,
                        starts_on=starts_on,
                        ends_on=ends_on,
                        source="historical_analysis_import",
                        notes=(
                            f"{row['source_file']} {row['sheet_name']} "
                            f"{row['column_label']}{row['row_index']}"
                        ),
                    )
                )
                counters["postings_created"] += 1

        db.commit()

    return HistoricalAnalysisImportSummary(
        duty_rows_read=counters["duty_rows_read"],
        posting_rows_read=counters["posting_rows_read"],
        people_created=counters["people_created"],
        periods_created=counters["periods_created"],
        units_created=counters["units_created"],
        duty_slots_created=counters["duty_slots_created"],
        duty_assignments_created=counters["duty_assignments_created"],
        postings_created=counters["postings_created"],
        existing_duty_assignments=counters["existing_duty_assignments"],
        existing_postings=counters["existing_postings"],
        skipped_unknown_people=counters["skipped_unknown_people"],
        skipped_unmapped_duties=counters["skipped_unmapped_duties"],
        source="historical_analysis_import",
    )


def purge_previous_historical_imports(db) -> Counter[str]:
    counters: Counter[str] = Counter()
    historical_slot_ids = select(DutySlot.id).where(DutySlot.source.in_(HISTORICAL_IMPORT_SOURCES))
    historical_batch_ids = select(ImportBatch.id).where(ImportBatch.import_kind.in_(HISTORICAL_IMPORT_KINDS))

    result = db.execute(delete(DutyAssignment).where(DutyAssignment.duty_slot_id.in_(historical_slot_ids)))
    counters["duty_assignments_deleted"] = result.rowcount or 0

    result = db.execute(delete(DutySlot).where(DutySlot.source.in_(HISTORICAL_IMPORT_SOURCES)))
    counters["duty_slots_deleted"] = result.rowcount or 0

    result = db.execute(delete(PersonPosting).where(PersonPosting.source.in_(HISTORICAL_IMPORT_SOURCES)))
    counters["postings_deleted"] = result.rowcount or 0

    source_record_ids = select(ImportSourceRecord.id).where(ImportSourceRecord.batch_id.in_(historical_batch_ids))
    result = db.execute(delete(ImportWarning).where(ImportWarning.batch_id.in_(historical_batch_ids)))
    counters["import_warnings_deleted"] = result.rowcount or 0

    result = db.execute(delete(ImportSourceRecord).where(ImportSourceRecord.batch_id.in_(historical_batch_ids)))
    counters["source_records_deleted"] = result.rowcount or 0

    result = db.execute(delete(ImportWarning).where(ImportWarning.source_record_id.in_(source_record_ids)))
    counters["source_record_warnings_deleted"] = result.rowcount or 0

    result = db.execute(delete(ImportBatch).where(ImportBatch.import_kind.in_(HISTORICAL_IMPORT_KINDS)))
    counters["import_batches_deleted"] = result.rowcount or 0
    return counters


def import_matched_history_into_session(
    db,
    matched_duties_path: Path,
    matched_postings_path: Path,
    *,
    replace_existing: bool = True,
) -> HistoricalAnalysisImportSummary:
    if not matched_duties_path.exists():
        raise FileNotFoundError(matched_duties_path)
    if not matched_postings_path.exists():
        raise FileNotFoundError(matched_postings_path)

    counters: Counter[str] = Counter()
    if replace_existing:
        counters.update(purge_previous_historical_imports(db))

    batch = ImportBatch(
        source_filename="matched_historical_analysis",
        source_path=str(matched_duties_path.parent),
        import_kind="historical_analysis_rebuild",
        status="running",
        source_metadata={
            "matched_duties": str(matched_duties_path),
            "matched_postings": str(matched_postings_path),
            "replace_existing": replace_existing,
        },
    )
    db.add(batch)
    db.flush()

    people = {
        person.canonical_name: person
        for person in db.scalars(select(Person).order_by(Person.canonical_name)).all()
    }

    with matched_duties_path.open(newline="", encoding="utf-8") as handle:
        for row in csv.DictReader(handle):
            counters["duty_rows_read"] += 1
            if row["duty_type"] == "UNMAPPED":
                counters["skipped_unmapped_duties"] += 1
                continue

            person = get_or_create_historical_person(db, row["canonical_name"], people, counters)
            year, month = parse_period(row["period"])
            period = get_or_create_analysis_period(db, year, month, counters)
            duty_date = date.fromisoformat(row["duty_date"])
            starts_at = datetime.combine(duty_date, datetime.min.time()).replace(hour=8)
            is_24hr = row["is_24hr"].casefold() == "true"
            duration_hours = 24 if is_24hr else 12
            slot = db.scalar(
                select(DutySlot).where(
                    DutySlot.rota_period_id == period.id,
                    DutySlot.duty_date == duty_date,
                    DutySlot.duty_type == row["duty_type"],
                    DutySlot.slot_label == row["duty_label"],
                )
            )
            if slot is None:
                from datetime import timedelta

                slot = DutySlot(
                    rota_period=period,
                    duty_date=duty_date,
                    duty_type=row["duty_type"],
                    slot_label=row["duty_label"],
                    starts_at=starts_at,
                    ends_at=starts_at + timedelta(hours=duration_hours),
                    is_24hr=is_24hr,
                    source="historical_analysis_import",
                    notes=(
                        f"{row['source_file']} {row['sheet_name']} "
                        f"{row['column_label']}{row['row_index']}"
                    ),
                )
                db.add(slot)
                db.flush()
                counters["duty_slots_created"] += 1

            existing = db.scalar(
                select(DutyAssignment).where(
                    DutyAssignment.duty_slot_id == slot.id,
                    DutyAssignment.person_id == person.id,
                )
            )
            if existing is not None:
                counters["existing_duty_assignments"] += 1
                continue

            db.add(DutyAssignment(duty_slot=slot, person=person, source="historical_analysis_import"))
            counters["duty_assignments_created"] += 1

    with matched_postings_path.open(newline="", encoding="utf-8") as handle:
        for row in csv.DictReader(handle):
            counters["posting_rows_read"] += 1
            person = get_or_create_historical_person(db, row["canonical_name"], people, counters)
            year, month = parse_period(row["period"])
            starts_on, ends_on = month_bounds(year, month)
            unit = get_or_create_unit(db, row["unit_label"], counters)
            posting_type = row["posting_label"].upper().replace(" ", "_")
            existing = db.scalar(
                select(PersonPosting).where(
                    PersonPosting.person_id == person.id,
                    PersonPosting.unit_id == unit.id,
                    PersonPosting.posting_type == posting_type,
                    PersonPosting.starts_on == starts_on,
                )
            )
            if existing is not None:
                counters["existing_postings"] += 1
                continue

            db.add(
                PersonPosting(
                    person=person,
                    unit=unit,
                    posting_type=posting_type,
                    starts_on=starts_on,
                    ends_on=ends_on,
                    source="historical_analysis_import",
                    notes=(
                        f"{row['source_file']} {row['sheet_name']} "
                        f"{row['column_label']}{row['row_index']}"
                    ),
                )
            )
            counters["postings_created"] += 1

    batch.status = "completed"
    batch.completed_at = datetime.utcnow()

    return HistoricalAnalysisImportSummary(
        duty_rows_read=counters["duty_rows_read"],
        posting_rows_read=counters["posting_rows_read"],
        people_created=counters["people_created"],
        periods_created=counters["periods_created"],
        units_created=counters["units_created"],
        duty_slots_created=counters["duty_slots_created"],
        duty_assignments_created=counters["duty_assignments_created"],
        postings_created=counters["postings_created"],
        existing_duty_assignments=counters["existing_duty_assignments"],
        existing_postings=counters["existing_postings"],
        skipped_unknown_people=counters["skipped_unknown_people"],
        skipped_unmapped_duties=counters["skipped_unmapped_duties"],
        source="historical_analysis_import",
    )


def rebuild_and_import_historical_analysis(
    db,
    historical_dir: Path = DEFAULT_HISTORICAL_DIR,
    output_dir: Path = DEFAULT_OUTPUT_DIR,
    reference_html: Path = DEFAULT_REFERENCE_HTML,
) -> dict[str, object]:
    dry_run_summary = run_dry_run(historical_dir, output_dir, reference_html)
    import_summary = import_matched_history_into_session(
        db,
        output_dir / "matched_duties.csv",
        output_dir / "matched_postings.csv",
        replace_existing=True,
    )
    db.commit()
    return {
        "dry_run": dry_run_summary,
        "import": asdict(import_summary),
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Dry-run historical rota analysis rebuild.")
    parser.add_argument("--apply-alias-suggestions", action="store_true")
    parser.add_argument("--import-matched-history", action="store_true")
    parser.add_argument("--alias-suggestions", type=Path, default=DEFAULT_ALIAS_SUGGESTIONS)
    parser.add_argument("--matched-duties", type=Path, default=DEFAULT_MATCHED_DUTIES)
    parser.add_argument("--matched-postings", type=Path, default=DEFAULT_MATCHED_POSTINGS)
    parser.add_argument("--historical-dir", type=Path, default=DEFAULT_HISTORICAL_DIR)
    parser.add_argument("--output-dir", type=Path, default=DEFAULT_OUTPUT_DIR)
    parser.add_argument("--reference-html", type=Path, default=DEFAULT_REFERENCE_HTML)
    args = parser.parse_args()

    if args.apply_alias_suggestions:
        summary = asdict(apply_alias_suggestions(args.alias_suggestions))
    elif args.import_matched_history:
        summary = asdict(import_matched_history(args.matched_duties, args.matched_postings))
    else:
        summary = run_dry_run(args.historical_dir, args.output_dir, args.reference_html)
    print(json.dumps(summary, indent=2, default=str))


if __name__ == "__main__":
    main()
