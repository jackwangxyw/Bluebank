/**
 * About and privacy.
 *
 * The privacy half has to keep saying three things however the wording changes:
 * what's collected, what isn't, and how to delete it. That's the part doing
 * actual work.
 */

import { REPO } from './Github'

export function About() {
  return (
    <div className="about">
      <section className="about-block">
        <h1 className="about-h1">About Bluebank</h1>
        <p className="about-lead">
          A free and open source practice tool for the official College Board question bank. 
        </p>
      </section>

      <section className="about-block">
        <h2 className="about-h2">How it works</h2>
        <p className="about-p">
          The questions aren't stored on a server anywhere. Your browser asks
          College Board for them directly and keeps the ones you open, so the app
          stays quick and works offline afterwards. The first
          load takes a second or two, since it pulls the list of all the
          questions before it can show you anything.
        </p>
        <p className="about-p">
          Marking happens as soon as you answer. On multiple choice you get the
          official explanation for every choice rather than just the correct one.
        </p>
        <p className="about-p">
          A practice set is always in the same order. The order comes from the
          question id itself, so question 40 is the same question every time you open the site.
          Questions added to the bank later get slotted in cleanly.
        </p>
      </section>

      <section className="about-block">
        <h2 className="about-h2">Privacy</h2>
        <p className="about-p">
          You don't need an account to use Bluebank. If you don't sign in, Bluebank doesn't collect any of your information.
          Google's sign-in code isn't even
          downloaded unless you click sign in.
        </p>
        <p className="about-p">
          The one place your browser does reach out to is College Board, for the
          questions themselves. They see your IP address the way any site you
          visit does.
        </p>
        <p className="about-p">
          Signing in only syncs
          your answers, your highlights, notes, and which questions you
          flagged, so you can start on a laptop and continue on your phone.
        </p>
        <p className="about-p">
          That practice history is all that gets stored.{' '}
          <strong>We don't store your email, your name or your picture.</strong>{' '}
          Google hands us an anonymous id for your account and that's the only
          thing your progress is attached to. 
        </p>
        <p className="about-p">
          You can delete all of it from the sync panel on the Stats page, which
          wipes everything held on the server. Your practice history on this
          computer stays, because that is stored in the site data. You can clear that too by going to the same place you clear cookies from.
        </p>
        <p className="about-p">
          If you want complete privacy, you can host the website yourself, more
          info is on{' '}
          <a className="about-link" href={REPO} target="_blank" rel="noreferrer">our
          GitHub</a>.
        </p>
      </section>

      <section className="about-block">
        <h2 className="about-h2">License</h2>
        <p className="about-p">
          Bluebank is open source under the GNU General Public License v3. 
        </p>
      </section>

      <section className="about-block">
        <h2 className="about-h2">Disclaimer</h2>
        <p className="about-p">
          Bluebank is free and non-commercial. It isn't affiliated with or
          endorsed by the College Board. SAT is a trademark registered by the
          College Board.
        </p>
      </section>
    </div>
  )
}
