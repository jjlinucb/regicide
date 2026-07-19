import { useState } from 'react';

/** Layered mountain silhouette banner, drawn from scratch in the spirit of the official Regicide site. */
function MountainBanner({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div className="rules-hero">
      <svg className="rules-hero-svg" viewBox="0 0 1200 360" preserveAspectRatio="xMidYMax slice" xmlns="http://www.w3.org/2000/svg">
        <rect width="1200" height="360" fill="url(#sky)" />
        <defs>
          <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#b9d4c4" />
            <stop offset="100%" stopColor="#7d97a0" />
          </linearGradient>
        </defs>
        <circle cx="980" cy="90" r="70" fill="#cfe4d6" opacity="0.5" />
        <circle cx="220" cy="70" r="50" fill="#cfe4d6" opacity="0.4" />
        <polygon points="0,260 180,120 340,240 520,80 700,230 860,140 1020,250 1200,150 1200,360 0,360" fill="#6f8a83" opacity="0.75" />
        <polygon points="0,300 260,190 480,290 680,170 900,300 1120,190 1200,260 1200,360 0,360" fill="#51687a" opacity="0.85" />
        <polygon points="0,340 200,260 460,340 720,250 1000,340 1200,280 1200,360 0,360" fill="#3a4a5c" />
      </svg>
      <div className="rules-hero-text">
        <h1>{title}</h1>
        <p>{subtitle}</p>
      </div>
    </div>
  );
}

function ClassCard({
  icon,
  name,
  tag,
  color,
  children,
}: {
  icon: React.ReactNode;
  name: string;
  tag: string;
  color: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rules-class-card" style={{ borderColor: color }}>
      <div className="rules-class-icon" style={{ background: color }}>
        {icon}
      </div>
      <div className="rules-class-name">{name}</div>
      <div className="rules-class-tag">{tag}</div>
      <p>{children}</p>
    </div>
  );
}

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <div className="rules-step">
      <div className="rules-step-n">{n}</div>
      <div>
        <div className="rules-step-title">{title}</div>
        <p>{children}</p>
      </div>
    </div>
  );
}

function RegicideTab() {
  return (
    <>
      <MountainBanner title="Regicide" subtitle="A cooperative card game — defeat 12 corrupted royals before your deck runs dry." />
      <div className="rules-body">
        <section className="rules-section">
          <h2>The Basics</h2>
          <p>
            Shuffle the Jacks, Queens and Kings into a face-down Castle deck — that's the parade of enemies you'll
            face, weakest to strongest. Everything else (2–10s, the four Animal Companions, and a few Jesters) forms
            your Tavern deck, dealt out as everyone's hand. Work together to whittle down every royal's health before
            your hands and deck are empty. Lose a single showdown against an enemy and the whole table loses.
          </p>
        </section>

        <section className="rules-section">
          <h2>A Turn, in Four Steps</h2>
          <div className="rules-steps">
            <Step n={1} title="Play or Yield">
              Play one card (or a matching-number combo) from your hand to attack — its number is the damage. Can't
              or don't want to attack? Yield instead, straight to Step 4.
            </Step>
            <Step n={2} title="Suit Power">
              Whatever you played, its suit power triggers — mandatory, never optional.
            </Step>
            <Step n={3} title="Deal Damage">
              Damage is applied to the enemy's health. Exactly match or exceed it and the royal falls.
            </Step>
            <Step n={4} title="Suffer Damage">
              Still standing? The enemy strikes back — discard cards worth at least its attack value, or the table
              loses.
            </Step>
          </div>
        </section>

        <section className="rules-section">
          <h2>Suit Powers</h2>
          <div className="rules-grid">
            <ClassCard icon="♥" name="Hearts" tag="Heal" color="#b8434a">
              Shuffle the discard pile and slide that many cards back under the Tavern deck, face down.
            </ClassCard>
            <ClassCard icon="♦" name="Diamonds" tag="Draw" color="#c99a3a">
              Everyone draws, starting with you, until that many cards have come out — nobody draws past their hand
              limit.
            </ClassCard>
            <ClassCard icon="♣" name="Clubs" tag="Double Damage" color="#4d6b3f">
              The damage from this card counts twice against the enemy's health.
            </ClassCard>
            <ClassCard icon="♠" name="Spades" tag="Shield" color="#3f4f6b">
              Reduce this enemy's attack by that much — shields stack and last until the enemy is dead.
            </ClassCard>
          </div>
        </section>

        <section className="rules-section">
          <h2>Good to Know</h2>
          <ul className="rules-list">
            <li>
              <strong>Animal Companions</strong> count as a 1 and can pair with one other card, adding both suit
              powers together.
            </li>
            <li>
              <strong>Combos</strong> let you play 2–4 cards of the same number at once, as long as they total 10 or
              less — powers resolve on the combined total.
            </li>
            <li>
              <strong>Enemy immunity</strong> — a royal ignores the suit power that matches its own suit (the damage
              still counts).
            </li>
            <li>
              <strong>The Jester</strong> cancels that immunity for the turn and lets its player hand the next turn to
              anyone at the table.
            </li>
            <li>Talk freely about strategy — just never hint at what's actually in your hand.</li>
          </ul>
        </section>

        <section className="rules-section rules-callout">
          <h2>Solo Play</h2>
          <p>
            Playing alone, you run a single 8-card hand and get two Jesters held in reserve — flip one anytime to
            discard your hand and refill. Win without touching either for a <strong>Gold</strong> victory, one for{' '}
            <strong>Silver</strong>, both for <strong>Bronze</strong>.
          </p>
        </section>
      </div>
    </>
  );
}

function LegacyTab() {
  return (
    <>
      <MountainBanner
        title="Regicide Legacy"
        subtitle="A 12-mission campaign for the Golden Blade Syndicate — your party grows, and so do the threats."
      />
      <div className="rules-body">
        <section className="rules-section">
          <h2>What's Different</h2>
          <p>
            Legacy takes the same four-step heartbeat as Regicide and wraps it in a campaign. Instead of one deck of
            playing cards, you're fielding 40 named members of the Golden Blade Syndicate — a mercenary guild whose
            roster permanently grows (and sometimes shrinks) as you complete each of the 12 missions. Suits become
            classes, enemies get names and mission-specific twists, and choices you make ripple into every future
            session.
          </p>
        </section>

        <section className="rules-section">
          <h2>The Four Classes</h2>
          <div className="rules-grid">
            <ClassCard icon="⚔" name="Warrior" tag="Double Damage" color="#8a3b3b">
              Plays like Clubs — the attack's damage is doubled against the enemy's health.
            </ClassCard>
            <ClassCard icon="🎵" name="Bard" tag="Draw Cards" color="#c99a3a">
              Plays like Diamonds — the party draws cards, in turn order, up to the attack's strength.
            </ClassCard>
            <ClassCard icon="✚" name="Cleric" tag="Heal" color="#b8434a">
              Plays like Hearts — shuffles the discard pile and tucks that many cards back under the reserve deck.
            </ClassCard>
            <ClassCard icon="🛡" name="Paladin" tag="Reduce Strength" color="#3f4f6b">
              Plays like Spades — knocks down the enemy's strength for the rest of the fight.
            </ClassCard>
          </div>
        </section>

        <section className="rules-section">
          <h2>A Turn, in Four Steps</h2>
          <div className="rules-steps">
            <Step n={1} title="Form an Attack">
              Play a single card, an Animal Companion paired with one other card, or a "Kinfolk" set of matching
              numbers totalling 10 or less.
            </Step>
            <Step n={2} title="Cast Spells">
              Magic classes (Bard, Cleric) resolve immediately, using the attack's total strength.
            </Step>
            <Step n={3} title="Deal Damage">
              Strength becomes damage — Warriors double it here. Enemy dead? Skip straight to the next fight.
            </Step>
            <Step n={4} title="Suffer Damage">
              Still alive? It strikes back (Paladins soften the blow first). Discard to cover it, or — once per hand
              at your limit — "feign death" and discard your whole hand regardless of total.
            </Step>
          </div>
        </section>

        <section className="rules-section">
          <h2>Good to Know</h2>
          <ul className="rules-list">
            <li>
              <strong>Enemy immunity</strong> still applies — an enemy ignores class powers matching its own icon.
            </li>
            <li>
              <strong>The Jester</strong> works differently here: play it into the middle of the table, and any
              player — including you — may silently claim it and take over the turn, ignoring that enemy's immunity
              entirely.
            </li>
            <li>Multi-card attacks (Kinfolk and Animal) resolve every class power once, at the combined strength.</li>
            <li>Communication rules are the same as classic Regicide — no hinting at your hand.</li>
          </ul>
        </section>

        <section className="rules-section rules-callout">
          <h2>Campaign Flow</h2>
          <p>
            Each mission ships as a sealed pack: story beats, new enemies, mission-only rules, and — on success — a
            reward pack that can add recruits to your permanent party or unlock new rules for good. Fail a mission and
            you crack open a special "Plan M" pack instead and try again with what you've got. Your party persists
            between attempts and missions either way — this is a campaign built to be played, not reset.
          </p>
        </section>

        <section className="rules-section rules-callout">
          <h2>Solo Play</h2>
          <p>
            Solo, you run a single 8-card hand. Twice per mission you may play a Jester on its own — always for 8
            strength, in a class of your choosing, ignoring enemy immunity — instead of playing from your hand.
          </p>
        </section>
      </div>
    </>
  );
}

export function RulesPage({ onBack }: { onBack: () => void }) {
  const [tab, setTab] = useState<'regicide' | 'legacy'>('regicide');

  return (
    <div className="rules-page">
      <nav className="rules-nav">
        <button type="button" className="rules-back" onClick={onBack}>
          ← Back
        </button>
        <div className="rules-tabs">
          <button
            type="button"
            className={`rules-tab${tab === 'regicide' ? ' active' : ''}`}
            onClick={() => setTab('regicide')}
          >
            Regicide
          </button>
          <button
            type="button"
            className={`rules-tab${tab === 'legacy' ? ' active' : ''}`}
            onClick={() => setTab('legacy')}
          >
            Regicide Legacy
          </button>
        </div>
      </nav>
      {tab === 'regicide' ? <RegicideTab /> : <LegacyTab />}
    </div>
  );
}
