"""1.2 ile eklenen varsayılan kurallar: yabancı kelimeler, fazlalıklar, kötü örnek davranış kalıpları.

match_type "desen": küçük harfe çevrilmiş metinde aranan düzenli ifade (ileri düzey).
"""

_EN = [
    # (İngilizce, [Türkçe öneriler])
    ("star", ["yıldız", "dünya yıldızı", "ünlü"]),
    ("superstar", ["büyük yıldız", "dünya yıldızı"]),
    ("süperstar", ["büyük yıldız", "dünya yıldızı"]),
    ("cool", ["havalı"]),
    ("okay", ["tamam"]),
    ("okey", ["tamam"]),
    ("wow", ["vay", "vay canına"]),
    ("yes", ["evet", "yaşasın"]),
    ("yeah", ["evet"]),
    ("sorry", ["pardon", "özür dilerim"]),
    ("bye", ["hoşça kal", "görüşürüz"]),
    ("hello", ["merhaba"]),
    ("thanks", ["teşekkürler", "sağ ol"]),
    ("thank you", ["teşekkür ederim"]),
    ("please", ["lütfen"]),
    ("baby", ["bebeğim", "tatlım"]),
    ("selfie", ["özçekim", "fotoğraf"]),
    ("show", ["gösteri"]),
    ("party", ["parti", "eğlence"]),
    ("team", ["takım", "ekip"]),
    ("boss", ["patron"]),
    ("cute", ["tatlı", "şirin"]),
    ("nice", ["güzel", "harika"]),
    ("wanted", ["aranıyor"]),
    ("one", ["bir"]),
    ("two", ["iki"]),
    ("three", ["üç"]),
    ("yey", ["yaşasın"]),
    ("style", ["tarz"]),
    ("fashion", ["moda"]),
    ("follower", ["takipçi"]),
    ("like", ["beğeni"]),
    ("live", ["canlı"]),
    ("bro", ["kardeşim", "dostum"]),
    ("dude", ["dostum"]),
    ("buddy", ["dostum", "arkadaşım"]),
    ("oh my god", ["vay canına", "eyvah"]),
    ("omg", ["vay canına", "eyvah"]),
    ("game over", ["oyun bitti"]),
    ("happy end", ["mutlu son"]),
    ("welcome", ["hoş geldin", "hoş geldiniz"]),
    ("good job", ["aferin", "harika iş"]),
    ("congratulations", ["tebrikler"]),
    ("hashtag", ["etiket"]),
    ("trend", ["akım", "moda"]),
    ("challenge", ["meydan okuma", "yarışma"]),
    ("influencer", ["fenomen"]),
    ("vlog", ["video günlüğü"]),
    ("event", ["etkinlik"]),
    ("mood", ["ruh hali", "keyif"]),
    ("best friend", ["en iyi arkadaş"]),
    ("lol", [""]),
]

_REDUNDANT = [
    # (ifade, tür, [öneriler], açıklama)
    ("tekrar yeniden", "ifade", ["yeniden", "tekrar"], "Aynı anlamdaki iki kelime yan yana."),
    ("yeniden tekrar", "ifade", ["tekrar", "yeniden"], "Aynı anlamdaki iki kelime yan yana."),
    ("geri iade", "kok", ["iade"], "'İade' zaten geri vermek demek."),
    ("birlikte beraber", "ifade", ["birlikte"], "Aynı anlamdaki iki kelime yan yana."),
    ("beraber birlikte", "ifade", ["birlikte"], "Aynı anlamdaki iki kelime yan yana."),
    ("en son sonunda", "ifade", ["sonunda"], "Gereksiz uzatma."),
    ("hala daha", "ifade", ["hâlâ"], "Gereksiz uzatma."),
    ("hâlâ daha", "ifade", ["hâlâ"], "Gereksiz uzatma."),
    ("ileriye doğru ilerle", "kok", ["ilerle"], "Gereksiz uzatma."),
    ("geriye doğru gerile", "kok", ["gerile"], "Gereksiz uzatma."),
    ("yukarıya doğru yüksel", "kok", ["yüksel"], "Gereksiz uzatma."),
    ("sonradan pişman", "kok", ["pişman"], "Pişmanlık zaten sonradan olur."),
    ("yalı daire", "kok", ["yalı"], "Yalı zaten bir konut; 'yalı dairesi' gereksiz uzatma."),
    ("küçük minik", "ifade", ["minik"], "Aynı anlamdaki iki kelime yan yana."),
    ("kocaman büyük", "ifade", ["kocaman"], "Aynı anlamdaki iki kelime yan yana."),
    ("büyük kocaman", "ifade", ["kocaman"], "Aynı anlamdaki iki kelime yan yana."),
    ("şimdi şu an", "ifade", ["şu an"], "Aynı anlamdaki iki kelime yan yana."),
    ("şu an şimdi", "ifade", ["şimdi"], "Aynı anlamdaki iki kelime yan yana."),
    ("önce ilk olarak", "ifade", ["ilk olarak"], "Gereksiz uzatma."),
    ("karşılıklı olarak birbirine", "ifade", ["birbirine"], "Gereksiz uzatma."),
]

# Kötü örnek / taklit edilebilir davranış kalıpları (küçük harfli metinde düzenli ifade)
_BEHAVIOR = [
    (r"kulağ[ıi]n[ıi]n dibinde", ["biraz uzağında", "yanında"], "kötü örnek davranış",
     "Birinin kulağının dibinde ses/müzik aleti çalmak taklit edilebilir; işitmeye zarar verebilir."),
    (r"kulağına (?:dayar|dayayarak|dayayıp|yaklaştırır|yaklaştırarak)", ["havaya doğru tutar"],
     "kötü örnek davranış", "Müzik aletini/ses kaynağını birinin kulağına dayamak taklit edilebilir olumsuz örnek."),
    (r"ağzına (?:döker|döküverir|boşaltır|tıkar|tıkıştırır|sokar|zorla)", ["eline verir", "ona uzatır"],
     "kötü örnek davranış", "Zorla içirme/yedirme ya da bilerek üstüne dökme izlenimi veriyor."),
    (r"(?:kafasını|başını|yüzünü) (?:[\w’'çğıöşü]+ ){0,4}(?:daldırır|daldırıp|sokar|sokup|batırır|batırıp)", [],
     "kötü örnek davranış", "Birinin kafasını zorla bir şeye daldırmak kötü örnek; serinletmek için güvenli bir yol seçin."),
    (r"(?:kafasına|başına|yüzüne|üstüne) (?:[\w’'çğıöşü]+ ){0,3}(?:döker|boşaltır|fırlatır|geçirir)", [],
     "kötü örnek davranış", "Birinin üstüne/kafasına bilerek bir şey dökmek ya da atmak olumsuz örnek."),
    (r"zorla (?:içirir|yedirir|içiriyor|yediriyor|içirmeye|yedirmeye)", [], "kötü örnek davranış",
     "Zorla yedirme/içirme olumsuz örnek."),
    (r"(?:tokat atar|tokatlar|çelme takar|saçını çeker|saçlarını çeker|yumruk atar|tekme atar|iterek düşürür|"
     r"itip düşürür|kafasına vurur|kafasına bir tane)", [], "şiddet",
     "Fiziksel şiddet içeren davranış; çocuklar taklit edebilir."),
    (r"(?:prize|elektrik kablosuna|kabloya) (?:dokunur|sokar|çatal|parmağını)", [], "çocuk güvenliği",
     "Elektrikle oynamak taklit edilebilir, hayati tehlike."),
    (r"(?:çakmak|kibrit) (?:çakar|yakar)", [], "çocuk güvenliği", "Ateşle oynamayı özendirebilir."),
    (r"(?:pencereden|balkondan|çatıdan|camdan) (?:atlar|sarkar|aşağı atlar)", [], "çocuk güvenliği",
     "Yüksekten atlamak/sarkmak taklit edilebilir tehlikeli davranış."),
    # argo kullanımlar: yalnızca hitap/sıfat olarak ("Selam kral!", "efsane bir parti") — "Kral Aslan" değil
    (r"(?:(?:selam|naber|hey|sağ ?ol|eyvallah)[,\s]+kral|kralım)(?![\wçğıöşü])", ["dostum", "şampiyon"],
     "argo / kaba dil", "Ekip notu: argoya kaçan hitap şekli."),
    (r"efsane(?:\s*!|\s+(?:bir|oldu|olacak|olmuş|ötesi)(?![\wçğıöşü]))", ["efsanevi", "harika"],
     "argo / kaba dil", "Ekip notu: 'efsanevi' daha uygun."),
]

# Argo / kaba söylemler (ekip notlarından ve yaygın kullanımdan). kok: ekler yeni köke ünlü uyumuyla taşınır
# ("gaza gelip" -> "iyice havaya girip")
_SLANG = [
    ("gaza gel", "kok", ["iyice havaya gir", "heyecanlan", "coş"], "argo / kaba dil", "Argo deyim."),
    ("gaza getir", "kok", ["heyecanlandır", "coştur"], "argo / kaba dil", "Argo deyim."),
    ("kafayı ye", "kok", ["çılgına dön", "aklını kaçır"], "argo / kaba dil", "Ekip notu: 'çılgına dönsün' daha uygun."),
    ("kafayı sıyır", "kok", ["çılgına dön"], "argo / kaba dil", "Argo deyim."),
    ("kanka", "kok", ["dostum", "arkadaşım"], "argo / kaba dil", "Argo hitap."),
    ("moruk", "kok", ["dostum"], "argo / kaba dil", "Argo hitap."),
    ("panpa", "kok", ["dostum"], "argo / kaba dil", "Argo hitap."),
    ("aynen", "kelime", ["kesinlikle", "evet"], "argo / kaba dil", "Sokak ağzı onay."),
    ("oha", "kelime", ["vay", "inanılmaz"], "argo / kaba dil", "Kaba ünlem."),
    ("çüş", "kelime", ["vay", "dur bakalım"], "argo / kaba dil", "Kaba ünlem."),
    ("yemezler", "kelime", ["inanmam", "olmaz öyle şey"], "argo / kaba dil", "Argo."),
    ("kapak olsun", "ifade", ["al sana", "işte böyle"], "argo / kaba dil", "Argo."),
    ("tırs", "kok", ["kork"], "argo / kaba dil", "Argo ('tırsmak')."),
    ("zıbar", "kok", ["uyu", "uzan"], "argo / kaba dil", "Kaba ('zıbarmak')."),
    ("tıkın", "kok", ["ye", "atıştır"], "argo / kaba dil", "Kaba ('tıkınmak')."),
    ("fırça ye", "kok", ["azar işit"], "argo / kaba dil", "Argo deyim."),
    ("atar yap", "kok", ["sinirlen", "kızgınlık göster"], "argo / kaba dil", "Argo deyim."),
    ("kafa ütüle", "kok", ["başını ağrıt"], "argo / kaba dil", "Argo deyim."),
    ("ağzını topla", "ifade", ["sözlerine dikkat et"], "argo / kaba dil", "Kaba ve sert söylem."),
    ("sus be", "ifade", ["biraz sessiz ol"], "argo / kaba dil", "Kaba susturma."),
    ("kuş beyinli", "ifade", ["dalgın", "şaşkın"], "hakaret / alay", "Ekip notu: hakaret ediyor, olumsuz örnek."),
    ("dangalak", "kok", ["şaşkın"], "hakaret / alay", "Hakaret."),
    ("enayi", "kok", ["saf", "şaşkın"], "hakaret / alay", "Hakaret."),
    ("pataklar", "kok", ["yakalar", "durdurur"], "şiddet", "Şiddet ('pataklamak')."),
    ("dayak", "kok", ["ceza", "azar"], "şiddet", "Şiddet çağrışımı."),
    ("geberti", "kok", ["yakala"], "şiddet", "Ölüm/şiddet çağrışımı."),
    ("bela", "kok", ["dert", "sorun"], "argo / kaba dil", "Ekip notu: yasaklı kelime; yerine 'derde' denilebilir."),
]

# Sık yapılan yazım hataları (Türk Dil Kurumu yazımı)
_SPELLING = [
    ("herkez", "herkes"), ("yalnış", "yanlış"), ("yanlız", "yalnız"), ("yanlızca", "yalnızca"),
    ("birşey", "bir şey"), ("herşey", "her şey"), ("hiçbirşey", "hiçbir şey"), ("hiç bir", "hiçbir"),
    ("her hangi", "herhangi"), ("şuan", "şu an"), ("malesef", "maalesef"),
    ("orjinal", "orijinal"), ("yada", "ya da"), ("pekçok", "pek çok"), ("birkez", "bir kez"),
    ("hergün", "her gün"), ("birsürü", "bir sürü"), ("tabiki", "tabii ki"), ("tabi ki", "tabii ki"),
    ("tamamiyle", "tamamıyla"), ("deyil", "değil"), ("laboratuar", "laboratuvar"), ("süpriz", "sürpriz"),
    ("sürpiz", "sürpriz"), ("traş", "tıraş"), ("egzos", "egzoz"), ("mütevazi", "mütevazı"),
    ("kordinat", "koordinat"), ("şarz", "şarj"), ("entellektüel", "entelektüel"), ("eşortman", "eşofman"),
    ("şöyleki", "şöyle ki"), ("oysaki", "oysa ki"), ("hiç kimse", None), ("birçoğu", None),
    ("yinede", "yine de"), ("bende", None), ("sende", None), ("herkeze", "herkese"),
    ("acele et", None), ("kirpik", None), ("yanlızlık", "yalnızlık"), ("kılavus", "kılavuz"),
    ("ihtyiaç", "ihtiyaç"), ("kaktüs", None), ("doktur", "doktor"),
    ("profesör", None), ("pantalon", "pantolon"), ("hoparlör", None), ("makina", "makine"),
    ("antreman", "antrenman"), ("kirbaç", "kırbaç"), ("fermuar", None), ("yiyecekmisin", "yiyecek misin"),
    ("istermisin", "ister misin"), ("gelirmisin", "gelir misin"), ("varmı", "var mı"), ("yokmu", "yok mu"),
    ("değilmi", "değil mi"), ("öylemi", "öyle mi"), ("nasılsınız?", None),
]

_EXACT = {"yada", "varmı", "yokmu", "değilmi", "öylemi"}  # ek alırsa başka kelimeyle karışabilecekler yalnızca tam kelime aranır

EXTRA_RULES = (
    [{"pattern": en, "match_type": "ifade" if " " in en else "kelime", "category": "yabancı kelime",
      "replacements": tr, "reason": "Türkçesi kullanılmalı (ekip notu: 'Türkçesi kullanılmalı').",
      "added": "1.2"} for en, tr in _EN]
    + [{"pattern": p, "match_type": mt, "category": "fazlalık / gereksiz uzatma", "replacements": reps,
        "reason": why, "added": "1.2"} for p, mt, reps, why in _REDUNDANT]
    + [{"pattern": p, "match_type": "desen", "category": cat, "replacements": reps, "reason": why,
        "added": "1.2"} for p, reps, cat, why in _BEHAVIOR]
    + [{"pattern": p, "match_type": mt, "category": cat, "replacements": reps, "reason": why,
        "added": "1.2"} for p, mt, reps, cat, why in _SLANG]
    # Yazım: kök + ek ("herkeze" de yakalanır), ünlü uyumu korunur
    + [{"pattern": wrong, "match_type": "kelime" if (" " in wrong or wrong in _EXACT) else "kok",
        "category": "dil bilgisi / yazım",
        "replacements": [right], "reason": f"Doğru yazımı: '{right}'.", "added": "1.2"}
       for wrong, right in _SPELLING if right]
)
