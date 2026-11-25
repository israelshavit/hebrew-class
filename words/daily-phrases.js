// Short phrases for the Word of the day: every other day it brings one of
// these instead of a single word (see PHRASES_FROM in app.js). Each row is
// ["English", "Transliteration", "Hebrew", "Spanish", "Portuguese"], with
// niqqud on the Hebrew, about family and positive things. They're shown in a
// mixed order that goes through the whole list before repeating, and a phrase
// a lesson taught so far already has is skipped, so add or remove rows freely.
// Keep each English, Spanish and Portuguese different from the others' (the
// check asks which Hebrew is which), and avoid phrases that change with the
// speaker's gender.
HebrewClass.setDailyPhrases([
  {
    title: "Family",
    es: { title: "Familia" },
    pt: { title: "Família" },
    rows: [
      ["My family", "Ha-mishpacha sheli", "הַמִּשְׁפָּחָה שֶׁלִּי", "Mi familia", "Minha família"],
      ["The whole family", "Kol ha-mishpacha", "כָּל הַמִּשְׁפָּחָה", "Toda la familia", "A família toda"],
      ["Family is everything", "Ha-mishpacha hi ha-kol", "הַמִּשְׁפָּחָה הִיא הַכֹּל", "La familia lo es todo", "A família é tudo"],
      ["A happy family", "Mishpacha me'usheret", "מִשְׁפָּחָה מְאֻשֶּׁרֶת", "Una familia feliz", "Uma família feliz"],
      ["My parents", "Ha-horim sheli", "הַהוֹרִים שֶׁלִּי", "Mis padres", "Meus pais"],
      ["My big brother", "Ha-ach ha-gadol sheli", "הָאָח הַגָּדוֹל שֶׁלִּי", "Mi hermano mayor", "Meu irmão mais velho"],
      ["My little sister", "Ha-achot ha-ktana sheli", "הָאָחוֹת הַקְּטַנָּה שֶׁלִּי", "Mi hermana menor", "Minha irmã mais nova"],
      ["Grandpa and Grandma", "Saba ve-savta", "סַבָּא וְסַבְתָּא", "El abuelo y la abuela", "Vovô e vovó"],
      ["My home", "Ha-bayit sheli", "הַבַּיִת שֶׁלִּי", "Mi casa", "Minha casa"],
      ["Family dinner", "Aruchat erev mishpachtit", "אֲרוּחַת עֶרֶב מִשְׁפַּחְתִּית", "Cena familiar", "Jantar em família"],
      ["Good friends", "Chaverim tovim", "חֲבֵרִים טוֹבִים", "Buenos amigos", "Bons amigos"],
      ["Good night", "Layla tov", "לַיְלָה טוֹב", "Buenas noches", "Boa noite"],
      ["Sweet dreams", "Chalomot paz", "חֲלוֹמוֹת פָּז", "Dulces sueños", "Bons sonhos"],
      ["Happy birthday", "Yom huledet same'ach", "יוֹם הֻלֶּדֶת שָׂמֵחַ", "Feliz cumpleaños", "Feliz aniversário"],
      ["Welcome (to everyone)", "Bruchim ha-ba'im", "בְּרוּכִים הַבָּאִים", "Bienvenidos", "Sejam bem-vindos"]
    ]
  },
  {
    title: "Positive phrases",
    es: { title: "Frases positivas" },
    pt: { title: "Frases positivas" },
    rows: [
      ["Thank you very much", "Toda raba", "תּוֹדָה רַבָּה", "Muchas gracias", "Muito obrigado/a"],
      ["Congratulations!", "Mazal tov!", "מַזָּל טוֹב!", "¡Felicidades!", "Parabéns!"],
      ["Well done!", "Kol ha-kavod!", "כָּל הַכָּבוֹד!", "¡Bien hecho!", "Muito bem!"],
      ["Have a nice day", "Yom na'im", "יוֹם נָעִים", "Que tengas un buen día", "Tenha um bom dia"],
      ["Have a good week", "Shavua tov", "שָׁבוּעַ טוֹב", "Buena semana", "Boa semana"],
      ["Happy holiday", "Chag same'ach", "חַג שָׂמֵחַ", "Felices fiestas", "Boas festas"],
      ["Happy New Year", "Shana tova", "שָׁנָה טוֹבָה", "Feliz año nuevo", "Feliz Ano Novo"],
      ["All the best", "Kol tuv", "כָּל טוּב", "Todo lo mejor", "Tudo de bom"],
      ["Everything will be OK", "Yihye be-seder", "יִהְיֶה בְּסֵדֶר", "Todo va a estar bien", "Vai dar tudo certo"],
      ["Get well soon", "Refu'a shlema", "רְפוּאָה שְׁלֵמָה", "Que te mejores pronto", "Melhoras"],
      ["See you soon", "Lehitra'ot be-karov", "לְהִתְרָאוֹת בְּקָרוֹב", "Nos vemos pronto", "Até logo"],
      ["Peace and love", "Shalom ve-ahava", "שָׁלוֹם וְאַהֲבָה", "Paz y amor", "Paz e amor"],
      ["Lots of love", "Hamon ahava", "הָמוֹן אַהֲבָה", "Mucho amor", "Muito amor"],
      ["A warm hug", "Chibuk cham", "חִבּוּק חַם", "Un abrazo cálido", "Um abraço apertado"],
      ["A big smile", "Chiyuch gadol", "חִיּוּךְ גָּדוֹל", "Una gran sonrisa", "Um grande sorriso"]
    ]
  }
]);
