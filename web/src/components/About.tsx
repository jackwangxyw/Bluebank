/**
 * About and privacy.
 *
 * The privacy half has to keep saying three things however the wording changes:
 * what's collected, what isn't, and how to delete it. That's the part doing
 * actual work.
 */

export function About() {
  return (
    <div className="about">
      <section className="about-block">
        <h1 className="about-h1">About Bluebank</h1>
        <p className="about-lead">
          A practice tool for the official College Board question bank. Every
          question here is theirs, and so is the explanation of why each answer
          choice is right or wrong.
        </p>
      </section>

      <section className="about-block">
        <h2 className="about-h2">How it works</h2>
        <p className="about-p">
          The questions aren't stored on a server anywhere. Your browser asks
          College Board for them directly and keeps the ones you open, so the app
          stays quick and works offline afterwards. That's also why the first
          load takes a second or two, since it pulls the list of all 3,767
          questions before it can show you anything.
        </p>
        <p className="about-p">
          Marking happens as soon as you answer. On multiple choice you get the
          official explanation for every choice rather than just the correct one,
          which is usually the more useful half.
        </p>
        <p className="about-p">
          A practice set is always in the same order. The order comes from the
          question id itself, so question 40 is the same question tomorrow and
          the same question on another computer. Questions added to the bank
          later slot in without renumbering the ones around them.
        </p>
      </section>

      <section className="about-block">
        <h2 className="about-h2">Privacy</h2>
        <p className="about-p">
          You don't need an account. If you don't sign in, nothing about you is
          sent anywhere and no server of ours is involved at all. No analytics,
          no tracking, no cookies from us. Google's sign-in code isn't even
          downloaded unless you click sign in.
        </p>
        <p className="about-p">
          Your browser does talk to two other places. College Board, for the
          questions, and Google Fonts for the typeface. Both see your IP address
          the way any site you visit does.
        </p>
        <p className="about-p">
          Signing in is only worth it if you use more than one computer. It syncs
          your answers, your highlights and notes, and which questions you
          flagged, so you can start on a laptop and carry on somewhere else.
        </p>
        <p className="about-p">
          That practice history is all that gets stored.{' '}
          <strong>We don't store your email, your name or your picture.</strong>{' '}
          Google hands us an anonymous id for your account and that's the only
          thing your progress is attached to, so we can't contact you and we
          can't tell who you are.
        </p>
        <p className="about-p">
          You can delete all of it from the sync panel on the Stats page, which
          wipes everything held on the server. Your practice history on this
          computer stays, because that was always yours.
        </p>
        <p className="about-p">
          Nobody else sees any of it. It isn't sold or shared, and it isn't used
          to train anything.
        </p>
      </section>

      <section className="about-block">
        <h2 className="about-h2">Fine print</h2>
        <p className="about-p">
          Bluebank is free and non-commercial. It isn't affiliated with or
          endorsed by the College Board. SAT is a trademark registered by the
          College Board.
        </p>
      </section>
    </div>
  )
}
