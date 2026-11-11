// Where things usually are in a grocery store. New store lists start with
// these sections, and the starter items below know which section they go
// in, so typing "ban" offers Bananas and puts them under Produce. Each list
// then learns its own store: rename or reorder the sections, move an item,
// and it's remembered for that list.

export const SECTIONS = [
  ['produce', 'Produce'],
  ['bakery', 'Bakery'],
  ['deli', 'Deli'],
  ['meat', 'Meat & Seafood'],
  ['dairy', 'Dairy & Eggs'],
  ['frozen', 'Frozen'],
  ['pantry', 'Pantry'],
  ['breakfast', 'Breakfast'],
  ['snacks', 'Snacks'],
  ['drinks', 'Drinks'],
  ['household', 'Household'],
  ['personal', 'Personal Care'],
  ['other', 'Other']
];

const STARTER = {
  produce: `Apples, Avocados, Bananas, Blueberries, Strawberries, Raspberries, Blackberries, Grapes, Oranges, Clementines,
    Lemons, Limes, Peaches, Pears, Pineapple, Watermelon, Cantaloupe, Mango, Kiwi, Cherries, Plums, Grapefruit,
    Lettuce, Romaine, Spinach, Kale, Salad mix, Cabbage, Coleslaw mix, Broccoli, Cauliflower, Carrots, Baby carrots,
    Celery, Cucumbers, Tomatoes, Cherry tomatoes, Bell peppers, Jalapeños, Onions, Red onion, Green onions, Garlic,
    Ginger, Potatoes, Sweet potatoes, Mushrooms, Zucchini, Squash, Butternut squash, Corn on the cob, Green beans,
    Asparagus, Brussels sprouts, Snap peas, Radishes, Beets, Eggplant, Cilantro, Parsley, Basil, Fresh herbs, Pumpkin`,
  bakery: `Bread, Sandwich bread, Wheat bread, Sourdough, Bagels, English muffins, Hamburger buns, Hot dog buns, Dinner rolls,
    Tortillas, Flour tortillas, Corn tortillas, Pita bread, Naan, Croissants, Muffins, Donuts, Cake, Cupcakes, Pie, Cookies`,
  deli: `Lunch meat, Deli turkey, Deli ham, Salami, Pepperoni, Sliced cheese, Rotisserie chicken, Hummus, Guacamole, Salsa,
    Potato salad, Pasta salad, Lunchables`,
  meat: `Chicken breasts, Chicken thighs, Chicken wings, Chicken tenders, Whole chicken, Ground beef, Ground turkey, Steak,
    Roast, Stew meat, Pork chops, Pork tenderloin, Ribs, Bacon, Sausage, Breakfast sausage, Italian sausage, Hot dogs,
    Bratwurst, Ham, Turkey, Meatballs, Salmon, Shrimp, Tilapia, Cod, Tuna steaks, Crab`,
  dairy: `Milk, Almond milk, Oat milk, Chocolate milk, Half and half, Heavy cream, Coffee creamer, Eggs, Butter, Margarine,
    Cheese, Shredded cheese, Cheddar cheese, Mozzarella, Parmesan, String cheese, Cream cheese, Cottage cheese, Feta,
    Sour cream, Yogurt, Greek yogurt, Yogurt tubes, Whipped cream, Biscuits, Crescent rolls, Cookie dough, Pudding,
    Orange juice`,
  frozen: `Ice cream, Popsicles, Frozen pizza, Frozen waffles, Frozen pancakes, Frozen vegetables, Frozen broccoli, Frozen corn,
    Frozen peas, Frozen fruit, Frozen berries, French fries, Tater tots, Hash browns, Chicken nuggets, Fish sticks,
    Frozen burritos, Frozen meals, Pizza rolls, Corn dogs, Frozen meatballs, Garlic bread, Pie crust, Ice`,
  pantry: `Pasta, Spaghetti, Macaroni, Egg noodles, Lasagna noodles, Ramen, Mac and cheese, Rice, Brown rice, Quinoa, Couscous,
    Pasta sauce, Alfredo sauce, Tomato sauce, Tomato paste, Diced tomatoes, Canned corn, Canned green beans, Black beans,
    Kidney beans, Refried beans, Baked beans, Chickpeas, Chicken broth, Beef broth, Soup, Chicken noodle soup,
    Tomato soup, Canned tuna, Canned chicken, Peanut butter, Jelly, Jam, Honey, Nutella, Flour, Sugar, Brown sugar,
    Powdered sugar, Baking soda, Baking powder, Yeast, Cornstarch, Vanilla, Chocolate chips, Cocoa powder, Cake mix,
    Brownie mix, Frosting, Sprinkles, Olive oil, Vegetable oil, Cooking spray, Vinegar, Salt, Pepper, Garlic powder,
    Onion powder, Chili powder, Cumin, Paprika, Cinnamon, Italian seasoning, Taco seasoning, Ketchup, Mustard,
    Mayonnaise, BBQ sauce, Ranch, Salad dressing, Soy sauce, Hot sauce, Worcestershire sauce, Pickles, Olives,
    Taco shells, Bread crumbs, Stuffing, Instant potatoes, Gravy, Canned fruit, Applesauce, Raisins, Nuts, Almonds,
    Peanuts, Marshmallows, Jello`,
  breakfast: `Cereal, Oatmeal, Instant oatmeal, Granola, Pancake mix, Waffle mix, Syrup, Pop-Tarts, Breakfast bars, Grits`,
  snacks: `Chips, Tortilla chips, Potato chips, Pretzels, Popcorn, Crackers, Goldfish, Cheez-Its, Graham crackers, Animal crackers,
    Granola bars, Protein bars, Fruit snacks, Trail mix, Rice cakes, Beef jerky, Candy, Chocolate, Gum, Oreos,
    Applesauce pouches, Fruit cups, Veggie straws, Dip`,
  drinks: `Water, Bottled water, Sparkling water, Soda, Juice, Apple juice, Juice boxes, Lemonade, Gatorade, Sports drinks,
    Coffee, K-Cups, Tea, Iced tea, Hot chocolate, Energy drinks, Beer, Wine, Drink mix`,
  household: `Paper towels, Toilet paper, Tissues, Napkins, Paper plates, Plastic cups, Trash bags, Sandwich bags, Freezer bags,
    Aluminum foil, Plastic wrap, Parchment paper, Dish soap, Dishwasher pods, Laundry detergent, Fabric softener,
    Dryer sheets, Bleach, Stain remover, All-purpose cleaner, Disinfecting wipes, Glass cleaner, Toilet cleaner, Sponges,
    Hand soap, Air freshener, Light bulbs, Batteries, Candles, Matches, Tape, Coffee filters, Dog food, Cat food,
    Cat litter, Dog treats`,
  personal: `Shampoo, Conditioner, Body wash, Bar soap, Toothpaste, Toothbrushes, Kids toothpaste, Floss, Mouthwash, Deodorant,
    Lotion, Sunscreen, Razors, Shaving cream, Cotton swabs, Cotton balls, Band-Aids, Ibuprofen, Tylenol,
    Kids Tylenol, Allergy medicine, Cough drops, Cold medicine, Vitamins, Kids vitamins, Feminine products, Contact solution,
    Lip balm, Hair ties, Hand sanitizer, Diapers, Baby wipes, Pull-Ups`
};

// How names are compared: "  Green  Onions " and "green onions" are the same.
export const nameKey = (name) => String(name).trim().toLowerCase().replace(/\s+/g, ' ');

// "tomatoes" and "tomato", "blueberries" and "blueberry" count as the same word.
const singularWord = (w) => w.replace(/ies$/, 'y').replace(/(o|ch|sh|ss|x)es$/, '$1').replace(/([^su])s$/, '$1');
const singular = (key) => key.split(' ').map(singularWord).join(' ');

// [{ name, key, section }] in the order above.
export const CATALOG = Object.entries(STARTER).flatMap(([section, names]) =>
  names.split(',').map((n) => n.replace(/\s+/g, ' ').trim()).filter(Boolean).map((name) => ({ name, key: nameKey(name), section })));

const BY_SINGULAR = new Map(CATALOG.map((c) => [singular(c.key), c.section]));
let mentions = null; // [regex, section], longest names first

// The standard section for something not seen before: the starter item it
// is, or (so "organic tomato" and "cheddar cheese slices" still land well)
// the longest starter item it mentions.
export function standardSection(name) {
  const key = singular(nameKey(name));
  if (!key) return null;
  if (BY_SINGULAR.has(key)) return BY_SINGULAR.get(key);
  mentions ||= [...BY_SINGULAR].filter(([k]) => k.length >= 3).sort((a, b) => b[0].length - a[0].length)
    .map(([k, section]) => [new RegExp(`(^|[^a-z0-9])${k.replace(/[^a-z0-9 ]/g, '.')}([^a-z0-9]|$)`), section]);
  return mentions.find(([re]) => re.test(key))?.[1] || null;
}
