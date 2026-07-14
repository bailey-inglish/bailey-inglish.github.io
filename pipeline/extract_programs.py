#!/usr/bin/env python3
"""Program requirement encodings for the dataset.

Each program below was extracted from its cached catalog page (see
sourceUrl) with dump_page.py and encoded into the requirements DSL by an
LLM-assisted pass, then checked by pipeline/validate.py (course ids must
exist in the edition's course DB; quotes must appear verbatim in the
cached page). Requirements are formalized into evaluable rule nodes;
catalog language that is not an auto-checkable course rule (e.g. advisor
approvals, alternative placement-exam paths, "approved list" pointers) is
kept as an informational `note` node — shown as context, never a manual
checkbox.

Usage: python3 extract_programs.py            # writes data/*/programs/*.json
"""
import json
from pathlib import Path

HERE = Path(__file__).parent
DATA = HERE.parent / "data"
BASE = {ed: cfg["base"] for ed, cfg in
        json.loads((HERE / "editions.json").read_text()).items()}


# ---------- DSL helpers ----------

def ALL(title=None, of=None, **kw):
    return {"type": "all", **({"title": title} if title else {}), "of": of, **kw}


def ANY(n, title=None, of=None, **kw):
    return {"type": "anyN", "n": n, **({"title": title} if title else {}), "of": of, **kw}


def C(course, minGrade=None, **kw):
    node = {"type": "course", "course": course, **kw}
    if minGrade:
        node["minGrade"] = minGrade
    return node


def HRS(hours, title=None, minGrade=None, inResidence=None, filter=None, **kw):
    node = {"type": "hours", "hours": hours, "filter": filter or {}, **kw}
    if title:
        node["title"] = title
    if minGrade:
        node["minGrade"] = minGrade
    if inResidence:
        node["inResidence"] = True
    return node


def GPA(min_, title=None, scope=None, **kw):
    node = {"type": "gpa", "min": min_, **kw}
    if title:
        node["title"] = title
    if scope:
        node["scope"] = scope
    return node


def MAN(text, title=None, **kw):
    node = {"type": "manual", "text": text, **kw}
    if title:
        node["title"] = title
    return node


def NOTE(text, title=None, **kw):
    """Informational catalog prose that isn't an auto-checkable requirement."""
    node = {"type": "note", "text": text, **kw}
    if title:
        node["title"] = title
    return node


# COLA field-of-study subject sets, for requirements phrased as "a course in
# a social science field" / "cultural expression, human experience, and
# thought" (a College of Liberal Arts field). Verified against the course DB.
SOCIAL_SCIENCE_SUBJECTS = [
    "ANT", "ECO", "GOV", "GRG", "LIN", "PSY", "SOC", "AMS", "WGS", "MAS",
    "AAS", "AFR", "URB", "CTI", "HDO",
]
CULTURAL_EXPRESSION_SUBJECTS = [
    "AHC", "ARH", "C C", "CL", "CTI", "E", "CMS", "F", "GSD", "HMN", "MUS",
    "PHL", "R S", "T D", "AET", "VAS", "GRG", "LIN",
]
FINE_ARTS_HUMANITIES_SUBJECTS = [
    "ARH", "MUS", "T D", "AHC", "C C", "CL", "HMN", "PHL", "E",
]
FOREIGN_LANG_SUBJECTS = [
    "ARA", "ASL", "BEN", "CHI", "CZ", "DAN", "DCH", "FR", "GER", "GK",
    "HEB", "HIN", "ITL", "JPN", "KOR", "LAL", "LAT", "MAL", "NOR", "PRS",
    "POL", "POR", "RUS", "SAN", "S C", "SAL", "SEL", "SPN", "SWA", "SWE",
    "TAM", "TEL", "TUR", "URD", "UKR", "YID", "YOR",
]


def SRC(edition, page, quote=None):
    src = {"url": BASE[edition] + page}
    if quote:
        src["quote"] = quote
    return src


# BA intermediate foreign-language proficiency courses (shared by BA Plan
# I and Plan II pages; ids verified against both editions' course DBs)
FOREIGN_LANG = [
    "ASL 311D", "ARA 611C", "BEN 312L", "CHI 612", "CHI 312L", "CZ 611C",
    "CZ 412L", "DAN 612", "DCH 612", "FR 611C", "FR 412K", "GER 612",
    "GK 312K", "GK 312L", "GK 610C", "GK 310K", "HEB 612C", "HEB 611C",
    "HIN 312L", "HIN 612", "ITL 611C", "JPN 611D", "KOR 312L", "LAL 611C",
    "LAT 511K", "MAL 312L", "NOR 612", "PRS 611C", "PRS 612C", "POL 611C",
    "POL 312L", "POR 611D", "RUS 611C", "RUS 412K", "SAN 312L", "S C 312L",
    "SAL 312L", "SEL 611C", "SEL 312L", "SPN 311", "SPN 611D", "SPN 311J",
    "SWA 611C", "SWE 612", "TAM 312L", "TEL 312L", "TUR 611C", "URD 312L",
    "UKR 312L", "YID 612", "YOR 611C",
]

SCIENCE_SUBJECTS = ["AST", "BIO", "CH", "GEO", "PS", "PHY"]


def foreign_language(edition, page):
    return ANY(1, "Foreign language proficiency", of=[
        HRS(3, "Intermediate language course",
            filter={"courses": FOREIGN_LANG,
                    "label": "Intermediate foreign-language course"}),
        NOTE("Certified proficiency on a placement or credit-by-exam test.",
            title="Certified proficiency by placement/exam"),
    ], source=SRC(edition, page,
                  "Proficiency in a language other than English is required."))


# ---------- Layers ----------

def university_general(edition):
    page = "/undergraduate/the-university/graduation/general-requirements/"
    return {
        "id": f"{edition}/layer/university-general",
        "edition": edition, "type": "layer",
        "name": "University General Requirements",
        "college": "The University",
        "sourceUrl": BASE[edition] + page,
        "rules": ALL("General requirements for graduation", of=[
            GPA(2.0, "University GPA of at least 2.00",
                source=SRC(edition, page)),
            HRS(60, "60 hours in residence", inResidence=True,
                filter={"label": "Any coursework in residence"},
                source=SRC(edition, page)),
            HRS(6, "Six advanced in-residence hours in major",
                inResidence=True,
                filter={"majorField": True, "division": "upper",
                        "label": "Upper-division coursework in the major, in residence"},
                source=SRC(edition, page)),
        ]),
    }


def cola_ba_plan_i(edition):
    page = "/undergraduate/liberal-arts/degrees-and-programs/bachelor-of-arts-plan-i/"
    return {
        "id": f"{edition}/layer/cola-ba-plan-i",
        "edition": edition, "type": "layer",
        "name": "Bachelor of Arts, Plan I — degree requirements",
        "college": "Liberal Arts",
        "totalHours": 120,
        "sourceUrl": BASE[edition] + page,
        "notes": ("Up to 16 hours pass/fail (electives only). No more than 39 "
                  "hours in one COLA/CNS field of study. Every BA Plan I "
                  "student must also complete a minor."),
        "rules": ALL("BA Plan I degree requirements", of=[
            HRS(120, "120 total hours", umbrella=True,
                filter={"label": "Any coursework"},
                source=SRC(edition, page, "A total of 120 semester hours is required.")),
            HRS(39 if edition == "2024-26" else 39, "39 upper-division hours",
                umbrella=True, filter={"division": "upper", "label": "Upper-division coursework"},
                source=SRC(edition, page)),
            HRS(24, "24 upper-division hours in residence", umbrella=True,
                inResidence=True,
                filter={"division": "upper", "label": "Upper-division in residence"},
                source=SRC(edition, page)),
            ANY(1, "Writing and literature", of=[
                C("E 316L"), C("E 316M"), C("E 316N"),
            ], source=SRC(edition, page)),
            foreign_language(edition, page),
            HRS(3, "Social science (a social science field)",
                filter={"subjects": SOCIAL_SCIENCE_SUBJECTS,
                        "label": "Social science coursework"},
                source=SRC(edition, page,
                           "semester credit hours in a social science field")),
            HRS(3, "Mathematics (beyond college algebra)",
                filter={"subjects": ["M", "SDS", "STA"],
                        "excludeCourses": ["M 301", "M 316K", "M 316L"],
                        "label": "Mathematics"},
                source=SRC(edition, page)),
            HRS(3, "Cultural expression, human experience, and thought",
                filter={"subjects": CULTURAL_EXPRESSION_SUBJECTS,
                        "label": "Cultural expression / human experience / thought"},
                source=SRC(edition, page,
                           "Cultural expression, human experience, and thought")),
            GPA(2.0, "GPA of at least 2.00 in the major",
                scope={"majorField": True, "label": "Coursework in the major"},
                source=SRC(edition, page)),
            NOTE("All students pursuing a major under the BA Plan I, with the "
                "exception of International Relations and Global Studies "
                "majors, must complete a minor.",
                title="Minor required", source=SRC(edition, page)),
        ]),
    }


def cns_college(edition):
    page = "/undergraduate/natural-sciences/graduation/"
    return {
        "id": f"{edition}/layer/cns-college",
        "edition": edition, "type": "layer",
        "name": "College of Natural Sciences — college requirements",
        "college": "Natural Sciences",
        "sourceUrl": BASE[edition] + page,
        "rules": ALL("CNS college requirements", of=[
            HRS(60, "60 hours in residence", inResidence=True,
                filter={"label": "Any coursework in residence"},
                source=SRC(edition, page)),
            HRS(6, "Six advanced in-residence hours in major",
                inResidence=True,
                filter={"majorField": True, "division": "upper",
                        "label": "Upper-division coursework in the major, in residence"},
                source=SRC(edition, page)),
        ]),
    }


# ---------- Majors ----------

def bs_sds(edition):
    page = "/undergraduate/natural-sciences/degrees-and-programs/bs-statistics-and-data-sciences/"
    src = lambda q=None: SRC(edition, page, q)  # noqa: E731
    return {
        "id": f"{edition}/major/bs-statistics-and-data-sciences",
        "edition": edition, "type": "major",
        "name": "Statistics and Data Science",
        "college": "Natural Sciences", "degreeType": "BS",
        "majorSubjects": ["SDS"],
        "totalHours": 120,
        "includes": [f"{edition}/layer/core-curriculum",
                     f"{edition}/layer/university-general",
                     f"{edition}/layer/cns-college"],
        "sourceUrl": BASE[edition] + page,
        "notes": ("Students must earn a grade of at least C- in all courses "
                  "required for the major and a GPA in these courses of at "
                  "least 2.00."),
        "rules": ALL("Prescribed work", of=[
            HRS(120, "120 total hours", umbrella=True,
                filter={"label": "Any coursework"},
                source=src("Enough additional coursework to make a total of 120 semester hours.")),
            HRS(21, "21 upper-division SDS hours in residence", umbrella=True,
                inResidence=True,
                filter={"subjects": ["SDS"], "division": "upper",
                        "label": "Upper-division SDS in residence"},
                source=src("At least 21 hours of upper-division course work in Statistics and Data Sciences must be completed in residence at the university.")),
            ANY(1, "Calculus sequence", of=[
                ALL("M 408C + 408D", of=[C("M 408C", "C-"), C("M 408D", "C-")]),
                ALL("M 408K + 408L + 408M",
                    of=[C("M 408K", "C-"), C("M 408L", "C-"), C("M 408M", "C-")]),
                ALL("M 408N + 408S + 408M",
                    of=[C("M 408N", "C-"), C("M 408S", "C-"), C("M 408M", "C-")]),
            ], source=src()),
            ANY(1, "Linear algebra", of=[C("M 340L", "C-"), C("M 341", "C-")],
                source=src()),
            ANY(1, "Introduction to programming",
                of=[C("C S 303E", "C-"), C("C S 312", "C-")], source=src()),
            C("C S 327E", "C-", title="Introduction to databases", source=src()),
            ALL("SDS core courses", of=[
                C("SDS 313", "C-"), C("SDS 315", "C-"), C("SDS 431", "C-"),
                C("SDS 334", "C-"), C("SDS 336", "C-"), C("SDS 354", "C-"),
                C("SDS 357", "C-"),
            ], source=src()),
            NOTE("Six additional credit hours from an approved list of courses",
                title="Six hours from the SDS approved list", source=src()),
            {"type": "concentration", "hours": 12, "upperHours": 6,
             "excludeSubjects": ["SDS"],
             "title": "Breadth: 12 hours in one other field (6 upper-division)",
             "source": src("At least 12 hours, including at least six upper-division hours, in a single field of study other than Statistics and Data Sciences.")},
            GPA(2.0, "GPA of at least 2.00 in major courses",
                scope={"subjects": ["SDS"], "label": "SDS coursework"},
                source=src()),
        ]),
    }


def ba_plan_ii(edition):
    page = "/undergraduate/liberal-arts/degrees-and-programs/bachelor-of-arts-plan-ii/"
    src = lambda q=None: SRC(edition, page, q)  # noqa: E731
    return {
        "id": f"{edition}/major/ba-plan-ii",
        "edition": edition, "type": "major",
        "name": "Plan II Honors Program",
        "college": "Liberal Arts", "degreeType": "BA (Plan II)",
        "majorSubjects": ["T C"],
        "totalHours": 120,
        "includes": [f"{edition}/layer/core-curriculum",
                     f"{edition}/layer/university-general"],
        "sourceUrl": BASE[edition] + page,
        "notes": ("Admission to Plan II is separate from admission to the "
                  "University. Students must maintain a University GPA of at "
                  "least 3.00 to remain in good standing; required Plan II "
                  "courses demand a C- minimum."),
        "rules": ALL("Prescribed work", of=[
            HRS(120, "120 total hours", umbrella=True,
                filter={"label": "Any coursework"},
                source=src("A degree program must include at least 120 semester hours, including at least 36 hours of upper-division coursework.")),
            HRS(36, "36 upper-division hours", umbrella=True,
                filter={"division": "upper", "label": "Upper-division coursework"},
                source=src()),
            C("T C 302", "C-", title="First-year tutorial", source=src(
                "Tutorial Course 302")),
            HRS(6, "Two semesters of T C 358 (junior seminars)",
                filter={"courses": ["T C 358"], "label": "T C 358"},
                minGrade="C-",
                source=src("two semesters of Tutorial Course 358")),
            ANY(1, "Senior thesis", of=[
                ALL("T C 660HA + 660HB",
                    of=[C("T C 660HA", "C-"), C("T C 660HB", "C-")]),
                C("T C 359T", "C-"),
            ], source=src()),
            ANY(1, "World literature", of=[
                ALL("E 303C + 303D", of=[C("E 303C", "C-"), C("E 303D", "C-")]),
                ALL("T C 303C + 303D", of=[C("T C 303C", "C-"), C("T C 303D", "C-")]),
            ], source=src()),
            ALL("Plan II philosophy (PHL 610Q)", of=[
                C("PHL 610QA", "C-"), C("PHL 610QB", "C-"),
            ], source=src("Philosophy 610Q")),
            ANY(1, "Honors social science", of=[
                C("S S 302C", "C-"), C("S S 302D", "C-"),
                C("S S 302E", "C-"), C("S S 302F", "C-"),
            ], source=src("Three hours of Honors Social Science")),
            NOTE("Six semester hours of non-United States history in the same "
                "geographic area.", title="Non-US history (6 hours, same area)",
                source=src()),
            ANY(1, "Plan II mathematics", of=[
                C("M 310P"),
                NOTE("Substitutions do exist for some of the requirements "
                    "outlined below; Plan II students should each meet with a "
                    "Plan II academic advisor to discuss their individual "
                    "academic plan.",
                    title="Approved calculus/math substitution"),
            ], source=src("Mathematics 310P")),
            ANY(1, "Logic or modes of reasoning", of=[
                C("T C 310"), C("PHL 313Q"),
                NOTE("Approved substitution for the logic requirement (consult "
                    "a Plan II advisor).", title="Approved substitution"),
            ], source=src()),
            ALL("Plan II science (18 hours)", of=[
                HRS(6, "Six hours of natural science",
                    filter={"subjects": SCIENCE_SUBJECTS,
                            "label": "Astronomy, biology, chemistry, geology, physical science, or physics"},
                    source=src()),
                ANY(1, "Plan II biology", of=[
                    C("BIO 301E"),
                    NOTE("Approved substitution for Biology 301E (consult a "
                        "Plan II advisor).", title="Approved substitution"),
                ], source=src("Biology 301E")),
                ANY(1, "Plan II physics", of=[
                    C("PHY 321"),
                    NOTE("Physics 321 or an approved alternative natural "
                        "science course as designated by Plan II.",
                        title="Approved alternative"),
                ], source=src()),
                HRS(18, "18 hours total in math/science fields", umbrella=True,
                    filter={"subjects": SCIENCE_SUBJECTS + ["M", "C S", "SDS", "MNS", "NTR", "STA"],
                            "label": "Math/science coursework"},
                    source=src()),
            ]),
            foreign_language(edition, page),
            HRS(3, "Fine arts / humanities",
                filter={"subjects": FINE_ARTS_HUMANITIES_SUBJECTS,
                        "label": "Art/music/theatre history or classical civ/humanities/literature/philosophy"},
                source=src("An approved three-hour course in art history, music history, "
                           "or history of theatre and dance")),
        ]),
    }


def ba_economics(edition):
    page = "/undergraduate/liberal-arts/degrees-and-programs/bachelor-of-arts-plan-i/economics/"
    src = lambda q=None: SRC(edition, page, q)  # noqa: E731
    pair = lambda a, b: ALL(f"{a} + {b}", of=[C(a, "C-"), C(b, "C-")])  # noqa: E731
    return {
        "id": f"{edition}/major/ba-economics",
        "edition": edition, "type": "major",
        "name": "Economics",
        "college": "Liberal Arts", "degreeType": "BA",
        "majorSubjects": ["ECO"],
        "includes": [f"{edition}/layer/core-curriculum",
                     f"{edition}/layer/university-general",
                     f"{edition}/layer/cola-ba-plan-i"],
        "sourceUrl": BASE[edition] + page,
        "notes": ("ECO 420K, 320L, 329, and 341K/441K must be completed in "
                  "residence. A student may not earn both the BA and BS in "
                  "Economics."),
        "rules": ALL("Major requirements", of=[
            ANY(1, "Mathematics requirement", of=[
                C("M 408Q", "C-"),
                pair("M 408K", "M 408L"), pair("M 408C", "M 408D"),
                pair("M 408N", "M 408S"), pair("M 408K", "M 408S"),
                pair("M 408C", "M 408L"), pair("M 408C", "M 408S"),
                pair("M 408R", "M 408L"), pair("M 408R", "M 408S"),
                pair("M 408N", "M 408L"),
            ], source=src()),
            HRS(32, "32 hours of economics", umbrella=True, minGrade="C-",
                filter={"subjects": ["ECO"], "label": "Economics coursework"},
                source=src()),
            ALL("Required economics courses", of=[
                C("ECO 304K", "C-"), C("ECO 304L", "C-"),
                ANY(1, "Intro microeconomic theory",
                    of=[C("ECO 420K", "C-"), C("ECO 420S", "C-")]),
                C("ECO 320L", "C-"), C("ECO 329", "C-"),
                ANY(1, "Econometrics",
                    of=[C("ECO 341K", "C-"), C("ECO 441K", "C-")]),
                C("ECO 101S", "C-"),
            ], source=src()),
            HRS(12, "12 additional upper-division economics hours",
                minGrade="C-",
                filter={"subjects": ["ECO"], "division": "upper",
                        "excludeCourses": ["ECO 320L", "ECO 329", "ECO 341K",
                                           "ECO 441K", "ECO 420K", "ECO 420S"],
                        "label": "Upper-division ECO electives"},
                source=src()),
            NOTE("At least six of the additional semester hours of "
                "upper-division coursework must be in courses for which a "
                "grade of at least C- in Economics 420K [or] Economics 420S "
                "is a prerequisite.",
                title="Six advanced hours beyond ECO 420K/420S",
                source=src()),
            GPA(2.0, "GPA of at least 2.00 in the major",
                scope={"subjects": ["ECO"], "label": "Economics coursework"},
                source=src()),
        ]),
    }


def ba_government(edition):
    page = "/undergraduate/liberal-arts/degrees-and-programs/bachelor-of-arts-plan-i/government/"
    src = lambda q=None: SRC(edition, page, q)  # noqa: E731
    return {
        "id": f"{edition}/major/ba-government",
        "edition": edition, "type": "major",
        "name": "Government",
        "college": "Liberal Arts", "degreeType": "BA",
        "majorSubjects": ["GOV"],
        "includes": [f"{edition}/layer/core-curriculum",
                     f"{edition}/layer/university-general",
                     f"{edition}/layer/cola-ba-plan-i"],
        "sourceUrl": BASE[edition] + page,
        "notes": ("No more than six hours of internship coursework may be "
                  "counted toward the major."),
        "rules": ALL("Major requirements", of=[
            HRS(30, "30 hours of government", umbrella=True, minGrade="C-",
                filter={"subjects": ["GOV"], "label": "Government coursework"},
                source=src("Thirty semester hours of government, at least 18 of which must be upper-division.")),
            HRS(18, "18 upper-division government hours", umbrella=True,
                minGrade="C-",
                filter={"subjects": ["GOV"], "division": "upper",
                        "label": "Upper-division government"},
                source=src()),
            NOTE("Students must take at least one upper-division course from "
                "three of the seven fields into which the department’s work "
                "is divided",
                title="Breadth across three of seven fields", source=src()),
            ANY(1, "Research seminar or internship", of=[
                C("GOV 362L"), C("GOV 662L"), C("GOV 371N"),
                C("GOV 372N"), C("GOV 373N"), C("GOV 374N"),
                NOTE("A three hour research seminar in government.",
                    title="Research seminar"),
            ], source=src()),
            ANY(1, "Tools course", of=[
                C("GOV 339L"), C("GOV 350K"), C("GOV 355M"), C("GOV 355N"),
                ANY(1, "Statistics option (not counted toward major hours)", of=[
                    C("ECO 329"), C("EDP 371"), C("PSY 317L"), C("SOC 327M"),
                    C("STA 309"), C("SDS 301"), C("AFR 302M"),
                ]),
                HRS(6, "Upper-division foreign language option",
                    filter={"subjects": FOREIGN_LANG_SUBJECTS, "division": "upper",
                            "label": "Upper-division foreign-language coursework"}),
            ], source=src()),
            GPA(2.0, "GPA of at least 2.00 in the major",
                scope={"subjects": ["GOV"], "label": "Government coursework"},
                source=src()),
        ]),
    }


# ---------- Minors & certificates ----------

def sds_minor(edition):
    page = "/undergraduate/natural-sciences/minor-and-certificate-programs/"
    src = lambda q=None: SRC(edition, page, q)  # noqa: E731
    return {
        "id": f"{edition}/minor/statistics-and-data-science",
        "edition": edition, "type": "minor",
        "name": "Statistics and Data Science Minor",
        "college": "Natural Sciences",
        "totalHours": 15,
        "sourceUrl": BASE[edition] + page,
        "notes": ("No credit-by-exam may be used to fulfill minor course "
                  "requirements. At least half of the coursework must be in "
                  "residence; at least nine hours must not also satisfy the "
                  "student's major."),
        "rules": ALL("Minor requirements", of=[
            HRS(3, "Statistics foundation", minGrade="C-",
                filter={"courses": ["SDS 320E", "SDS 320H", "SDS 315"],
                        "label": "Statistics foundation"}, source=src()),
            HRS(3, "Data science foundation", minGrade="C-",
                filter={"courses": ["SDS 322E", "SDS 313"],
                        "label": "Data science foundation"}, source=src()),
            HRS(3, "Programming foundation", minGrade="C-",
                filter={"courses": ["C S 303E", "C S 312", "C S 312H"],
                        "label": "Programming foundation"}, source=src()),
            HRS(6, "Supplementary courses", minGrade="C-",
                filter={"courses": ["SDS 324E", "SDS 334", "SDS 326E",
                                    "SDS 336", "C S 327E", "SDS 321",
                                    "SDS 431", "M 362K", "M 378K", "SDS 366"],
                        "label": "SDS minor supplementary list"},
                source=src()),
        ]),
    }


def prehealth_cert(edition):
    page = "/undergraduate/natural-sciences/minor-and-certificate-programs/"
    src = lambda q=None: SRC(edition, page, q)  # noqa: E731
    return {
        "id": f"{edition}/certificate/pre-health-professions",
        "edition": edition, "type": "certificate",
        "name": "Pre-Health Professions Certificate",
        "college": "Natural Sciences",
        "totalHours": 20,
        "sourceUrl": BASE[edition] + page,
        "notes": ("Two tracks (science major / non-science major). Each "
                  "course requires a grade of at least C-; at least nine "
                  "hours in residence."),
        "rules": ALL("Certificate requirements", of=[
            ANY(2, "Two of the NSC health-professions seminars", of=[
                C("NSC 107J", "C-"), C("NSC 107K", "C-"), C("NSC 107M", "C-"),
            ], source=src()),
            NOTE("Complete 18 hours chosen from the following themes relevant "
                "to healthcare.",
                title="18 hours from approved healthcare themes",
                source=src()),
        ]),
    }


REGISTRY = {
    "2024-26": [university_general, cola_ba_plan_i, cns_college, bs_sds,
                ba_plan_ii, ba_economics, ba_government, sds_minor,
                prehealth_cert],
    "2022-24": [university_general, cola_ba_plan_i, cns_college, bs_sds,
                ba_plan_ii, ba_economics, ba_government],
}


def rebuild_index(edition: str) -> int:
    """Rebuild programs-index.json from EVERY program file in the directory
    (curated + auto), so it never matters which extractor runs last."""
    outdir = DATA / edition / "programs"
    index = []
    for f in sorted(outdir.glob("*.json")):
        p = json.loads(f.read_text())
        index.append({"id": p["id"], "type": p["type"], "name": p["name"],
                      "college": p["college"],
                      **({"degreeType": p["degreeType"]} if p.get("degreeType") else {}),
                      **({"auto": True} if p.get("auto") else {}),
                      "file": f"programs/{f.name}"})
    (DATA / edition / "programs-index.json").write_text(
        json.dumps({"edition": edition, "programs": index}, indent=1,
                   ensure_ascii=False))
    return len(index)


def main() -> None:
    for edition, builders in REGISTRY.items():
        outdir = DATA / edition / "programs"
        outdir.mkdir(parents=True, exist_ok=True)
        for build in builders:
            prog = build(edition)
            slug = prog["id"].split("/", 1)[1].replace("/", "-")
            (outdir / f"{slug}.json").write_text(
                json.dumps(prog, indent=1, ensure_ascii=False))
        n = rebuild_index(edition)
        print(f"[{edition}] wrote {len(builders)} curated programs; index has {n}")


if __name__ == "__main__":
    main()
