// Plain words people budget, save and write notes with, which are no one's
// name: "Dining out", "New roof", "Gift for mom", "Joint savings". With the
// common, business and movement words, they make up the everyday words that
// telling a person from a shop reads (personShape.ts), and the only words a
// label or a row typed in may hold for Chat to show it as written (chat/).
// A word that is also a given name or surname ("Rose", "Baker") is never
// added here. Pure.

const PLAIN_WORDS = new Set(
  [
    // Small words that join others.
    'about after again all also am an and any are around as at back be been before big but',
    'by can did do does each else extra for get gets getting got had has have her here his',
    'how if in into is it its just last less me more most my new next no not now of off old',
    'on one only or other our out over own per same she so some than that the their them',
    'then there these they this those too two under up us was we were what when where which',
    'who why you your great runs trips',
    // Time and how often.
    'annual annually biweekly daily day days month monthly months quarter quarterly today',
    'tomorrow week weekend weekly weeks year yearly years yesterday',
    // Food and eating out.
    'alcohol beer breakfast brunch coffee dessert dining dinner drink drinks eating fast lunch',
    'meal meals snack snacks takeout treats',
    // Home.
    'appliance appliances bathroom bedroom cable decor deck electricity fence furnace hvac',
    'household housing improvement internet maintenance moving remodel repairs roof sewer',
    'solar trash upkeep yard chest',
    // Getting around.
    'bike bus car cars commute flight flights getting gasoline maintenance mileage parking',
    'registration rideshare taxi tolls train transit transportation vacation vehicle',
    // Shopping and family.
    'baby birthday birthdays children christmas clothes clothing costume diapers dog dogs',
    'donations gadgets gear holidays hobbies hobby kid kids laptop pet presents',
    'shopping stuff toy wedding anniversary engagement honeymoon graduation',
    // Health and care.
    'braces checkup contacts dentist doctor glasses haircut hospital medical medicine',
    'personal prescription prescriptions surgery therapy vet vision wellness',
    // What a practice is named for ("Acme Physical Therapy", "Rocky Mountain Pediatrics").
    'acupuncture cardiology chiropractic dermatology diagnostics imaging midwifery occupational',
    'optometry orthodontics orthopedics pediatric pediatrics physical physicians radiology',
    'surgical urology',
    // Fun.
    'apps books concert concerts entertainment events fun games gaming movies party',
    'streaming tickets vacations',
    // Money and accounts.
    'atm balance bonus budget budgets check checks checking college debt debts deposit donation education',
    'emergency equity everyday funds goal goals government high hsa fsa income investing',
    'investment investments main misc miscellaneous paycheck pension plan primary rainy',
    'refund reimbursed reimbursement retirement salary save saving spending student',
    'tax yield brokerage individual joint secondary heloc hysa account accounts acct card cards',
    // Work and pay, and public pension plans ("Colorado PERA").
    'direct employer job office payroll wages work calpers calstrs fers pera strs tsp',
    // Places a goal or pension is named for; states that are also given names are left out.
    'alabama alaska arkansas california colorado connecticut delaware hawaii idaho illinois',
    'iowa kansas kentucky louisiana maine maryland massachusetts michigan minnesota',
    'mississippi missouri nebraska hampshire jersey mexico york ohio oklahoma oregon',
    'pennsylvania rhode island tennessee texas utah vermont wisconsin wyoming',
    'beach mountain mountains',
    // Countries and regions a trip is saved for; ones that are also given names are left out.
    'africa asia australia austria belgium brazil canada caribbean denmark egypt england',
    'europe finland france germany greece iceland ireland italy japan korea morocco',
    'netherlands norway peru poland portugal scotland spain sweden switzerland thailand',
    'vietnam',
    // More of what budgets and goals are for.
    'activities activity airfare alarm apartment app apps beauty bills boat boots buffer',
    'camp camping celebration classes cloud condo copay copays cost costs counseling',
    'cruise date dates deductible detailing dmv down escrow estimated expense',
    'expenses father federal formula golf haircuts homeowners hoa inspection irs',
    'irregular lease license life lodging loans luggage lunches makeup massage meat meds',
    'membership memberships mental metro motorcycle news night nights offering passport',
    'people pest platinum plus points pool premiums prime produce protein public',
    'recycling renters rv sapphire security sinking ski skincare soccer software',
    'souvenirs sports storage subscriptions subway supplements swim tennis thanksgiving',
    'tithe tithing toiletries truck tv unlimited uniform uniforms unit urgent video videos',
    'visit visits vitamins wash wifi yoga',
    // What a note says happened.
    'bought cancelled canceled charge charged deal exchange gift order ordered owe owed paid',
    'pickup purchase purchases refunded return returned sale split shared trial',
    // Everyday verbs and words a note is written with.
    'came come cover covered gave give go going half left made make need needed still',
    'due moved rest run took take total used went',
    // More words goals and notes are written with ("Car payoff", "Giving", "Cleaning lady").
    'bread ending giving lady payoff projects support',
  ]
    .join(' ')
    .split(' '),
)

/** Whether a word, in any case, is a plain one people budget and write notes with. */
export function isPlainWord(word: string): boolean {
  return PLAIN_WORDS.has(word.toLowerCase())
}
