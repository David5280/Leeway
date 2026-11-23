// Common given names, for telling a person from a word in a label the owner
// wrote (ownerText.ts). A name with an owner's "'s" is always a person's
// ("Bill's car"); the name of a shop of one word ("Wegmans", "Target") may
// vouch for that word ("Wegmans groceries") unless it is a given name too
// ("Ross allowance", "Ruby's Savings"); and no surname read there as the word
// (commonWords.ts) is one. The list need not be complete: a name missing from
// it is still hidden in a label unless a shop of that very name is in the
// owner's data. Pure.

const GIVEN_NAMES: ReadonlySet<string> = new Set(
  [
    'aaron abby abigail adam adrian aidan alan albert alex alexander alfred alice alicia',
    'allison amanda amber amy andre andrea andrew angel angela anita ann anna anne anthony',
    'antonio april arthur ashley audrey austin autumn avery barbara barry ben benjamin',
    'bernard beth betty beverly bill billy blake bob bobby bonnie brad bradley brandon brenda',
    'brendan brett brian brianna brittany brooke bruce bryan buck bud caitlin caleb calvin',
    'cameron carl carla carlos carmen carol caroline carolyn casey catherine chad charles',
    'charlie charlotte chelsea cheryl chloe chris christian christina christine christopher',
    'cindy claire clara clark clay clayton cody colin connor courtney craig crystal curtis',
    'cynthia daisy dale dallas dan dana daniel danielle danny darren dave david dawn dean',
    'deborah debra denise dennis derek devin diana diane diego dominic don donald donna doris',
    'dorothy doug douglas drew duane duke dustin dylan earl eddie edgar edith edward eleanor',
    'elena eli elijah elizabeth ella ellen elliot emily emma eric erica erin esther ethan',
    'eugene eva evan evelyn faith felix fernando fiona florence floyd frances francis frank',
    'fred gabriel gabriela gail gary gavin gene george gerald gilbert gina glenn gloria',
    'gordon grace graham grant greg gregory hailey hannah harold harper harry harvey hazel',
    'heather hector heidi helen henry herbert holly hope howard hugh hunter ian irene iris',
    'isaac isabel isabella ivan ivy jack jackie jacob jacqueline jade jake james jane janet',
    'janice jared jasmine jason javier jay jean jeff jeffrey jenna jennifer jenny jeremy',
    'jerome jerry jesse jessica jill jim jimmy joan joanne jocelyn joe joel john johnny jon',
    'jonathan jordan jorge jose joseph josephine josh joshua joy joyce juan judith judy julia',
    'julian julie june justin kai karen kate katherine kathleen kathy katie kayla keith kelly',
    'ken kenneth kevin kim kimberly kristen kyle lance lane larry laura lauren lawrence leah',
    'lee leo leon leonard leroy leslie lewis liam lillian lily linda lisa logan lois lori',
    'louis louise lucas lucy luis luke lydia lynn madison malcolm mandy manuel marcus',
    'margaret maria marie marilyn mario mark martha martin marvin mary mason matt matthew max',
    'maya megan melanie melissa mia michael michelle miguel mike mildred miles mitchell molly',
    'monica morgan nancy naomi natalie nathan neil nicholas nick nicole nina noah nora norman',
    'oliver olivia omar oscar owen paige pamela parker pat patricia patrick paul paula pearl',
    'pedro peggy penny peter phil philip phyllis priscilla quinn rachel ralph randy ray',
    'raymond rebecca reese reggie regina ricardo rich richard rick ricky riley rita robert',
    'roberto robin rodney roger roland ron ronald rosa rose ross rowan roy ruby russell ruth',
    'ryan sabrina sage sally sam samantha samuel sandra sara sarah savannah scott sean seth',
    'shane sharon shawn shirley simon skyler sophia spencer stacy stanley stella stephanie',
    'stephen steve steven stuart sue summer susan sylvia tamara tammy tara taylor ted teresa',
    'terry theodore theresa thomas tiffany tim timothy tina todd tom tommy tony tracy travis',
    'trevor troy tyler valerie vanessa vera veronica victor victoria vincent violet virginia',
    'vivian walker walter wanda ward warren wayne wendy wesley whitney will william winter',
    'wolf yvonne zach zachary zoe',
  ]
    .join(' ')
    .split(' '),
)

/** Whether a word, in any case, is a common given name ("Ross", "Ruby", "Will"). */
export function isGivenName(word: string): boolean {
  return GIVEN_NAMES.has(word.toLowerCase())
}
