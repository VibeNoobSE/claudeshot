registerGame("flappy", "🐦 Flappy", "SPACE or ↑ to flap", "Survival — last alive wins", class extends Phaser.Scene {
  create() {
    this.cameras.main.setBackgroundColor("#1a3a5e");
    this.bird=this.add.circle(120,H/2,14,0xf7c948); this.physics.add.existing(this.bird); this.bird.body.setGravityY(800).setCollideWorldBounds(true);
    this.pipes=this.physics.add.group(); this.score=0; this.alive=true;
    this.scoreTxt=this.add.text(W/2,30,"0",{fontSize:"36px",color:"#fff",fontFamily:"monospace"}).setOrigin(0.5);
    this.time.addEvent({delay:1800,callback:this.addPipes,callbackScope:this,loop:true});
    this.input.keyboard.on("keydown-SPACE",()=>this.flap()); this.input.keyboard.on("keydown-UP",()=>this.flap());
    this.physics.add.overlap(this.bird,this.pipes,()=>{if(this.alive){this.alive=false;this.physics.pause();this.add.text(W/2,H/2,"GAME OVER",{fontSize:"40px",color:"#e94560",fontFamily:"monospace"}).setOrigin(0.5);}});
  }
  flap(){if(this.alive)this.bird.body.setVelocityY(-320);}
  addPipes(){if(!this.alive)return;const gap=140,gy=Phaser.Math.Between(80,H-80-gap);
    [this.add.rectangle(W+30,gy/2,52,gy,0x4ecca3),this.add.rectangle(W+30,gy+gap+(H-gy-gap)/2,52,H-gy-gap,0x4ecca3)].forEach(p=>{this.pipes.add(p);this.physics.add.existing(p);p.body.setVelocityX(-180).setImmovable(true).setAllowGravity(false);this.time.delayedCall(6000,()=>p.destroy());});
    this.scoreTxt.setText(""+(++this.score));}
  update(){}
});
