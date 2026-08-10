import { Link } from "react-router-dom";

function Profile() {
  return (
    <div className="profile-page">
      <header className="dashboard-header">
        <Link to="/" className="logo">
          NeuroCode
        </Link>

        <nav>
          <Link to="/dashboard">Dashboard</Link>
          <Link to="/courses">Courses</Link>
        </nav>
      </header>

      <main className="profile-content">
        <section className="profile-intro">
          <p className="eyebrow">YOUR PROFILE</p>

          <h1>Your learning journey.</h1>

          <p>
            Track your progress, practice history, and skills as you learn.
          </p>
        </section>

        <section className="profile-card">
          <div className="avatar">R</div>

          <div>
            <h2>Student</h2>
            <p>NeuroCode learner</p>
          </div>
        </section>

        <section className="stats-grid">
          <div>
            <span>Lessons completed</span>
            <strong>0</strong>
          </div>

          <div>
            <span>Challenges solved</span>
            <strong>0</strong>
          </div>

          <div>
            <span>Learning streak</span>
            <strong>0 days</strong>
          </div>
        </section>

        <section className="skills-section">
          <p className="eyebrow">SKILLS</p>

          <h2>What you're learning</h2>

          <div className="skill">
            <div>
              <span>Java Fundamentals</span>
              <span>0%</span>
            </div>

            <div className="skill-bar">
              <div></div>
            </div>
          </div>

          <div className="skill">
            <div>
              <span>Problem Solving</span>
              <span>0%</span>
            </div>

            <div className="skill-bar">
              <div></div>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}

export default Profile;